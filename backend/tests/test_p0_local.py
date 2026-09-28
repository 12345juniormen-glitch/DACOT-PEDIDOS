"""P0 regressions; intentionally runnable only by the isolated local runner."""

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import jwt
import pytest
import requests
from fastapi import HTTPException
from pymongo import MongoClient

from core.security import hash_password, verify_password
from core.db import get_db
from modules.auth.seed import seed_admin_and_restaurant
from modules.orders import routes as order_routes
from modules.orders.routes import OrderStatusInput
from core.deps import Tenant


pytestmark = pytest.mark.skipif(
    os.environ.get("DACOT_LOCAL_INTEGRATION") != "1"
    or not os.environ.get("REACT_APP_BACKEND_URL", "").startswith("http://127.0.0.1:"),
    reason="Only the disposable loopback integration runner may run these tests",
)
API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


def test_v1_status_contract_has_only_adjacent_reversals():
    assert order_routes.ALLOWED_TRANSITIONS == {
        "new": {"in_preparation", "cancelled"},
        "in_preparation": {"new", "ready", "cancelled"},
        "ready": {"in_preparation", "delivered", "cancelled"},
        "delivered": set(),
        "cancelled": set(),
    }


def test_revenue_uses_delivery_day_and_matches_drilldown():
    tenant_id = uuid.uuid4().hex[:24]
    now = int(time.time())
    handoff = jwt.encode({
        "sub": f"tenant_user:{uuid.uuid4().hex}", "restaurant_id": tenant_id,
        "role": "admin", "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
        "exp": now + 60, "jti": uuid.uuid4().hex, "handoff_version": 1,
        "hub_access": {"user": 1, "tenant": 1, "module": 1},
    }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")
    response = requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=20)
    assert response.status_code == 200, response.text[:200]
    headers = {"Authorization": f"Bearer {response.json()['token']}"}
    product = requests.post(f"{API}/products", json={"name": "P0 metric", "price": 20, "category": "Test"}, headers=headers, timeout=20)
    assert product.status_code == 201, product.text[:200]

    def deliver():
        order = requests.post(f"{API}/orders", json={"items": [{"product_id": product.json()["id"], "quantity": 1}]}, headers=headers, timeout=20)
        assert order.status_code == 201, order.text[:200]
        for target in ("in_preparation", "ready", "delivered"):
            result = requests.patch(f"{API}/orders/{order.json()['id']}/status", json={"status": target}, headers=headers, timeout=20)
            assert result.status_code == 200, result.text[:200]
        return order.json()["id"]

    start_local = datetime.now(ZoneInfo("America/Sao_Paulo")).replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = (start_local.astimezone(timezone.utc) - timedelta(seconds=1)).isoformat()
    old_created = deliver()
    created_today = deliver()
    with MongoClient(os.environ["MONGO_URL"]) as client:
        orders = client[os.environ["DB_NAME"]].orders
        orders.update_one({"id": old_created, "restaurant_id": tenant_id}, {"$set": {"created_at": yesterday}})
        orders.update_one({"id": created_today, "restaurant_id": tenant_id}, {"$set": {"delivered_at": yesterday}})

    stats = requests.get(f"{API}/orders/stats", headers=headers, timeout=20).json()
    drilldown = requests.get(f"{API}/orders", params={"delivered_today_only": "true"}, headers=headers, timeout=20).json()
    assert stats["orders_created_today"] == 1
    assert stats["orders_delivered_today"] == 1
    assert stats["today_revenue"] == 20
    assert [o["id"] for o in drilldown] == [old_created]
    assert sum(o["total"] for o in drilldown) == stats["today_revenue"]
    assert stats["avg_order_total_minutes_today"] is not None


def test_login_rate_limit_is_shared_and_returns_retry_after():
    email = f"missing-{uuid.uuid4().hex}@example.com"
    for _ in range(10):
        response = requests.post(f"{API}/auth/login", json={"email": email, "password": "wrong"}, timeout=20)
        assert response.status_code == 401
    blocked = requests.post(f"{API}/auth/login", json={"email": email, "password": "wrong"}, timeout=20)
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0
    spoofed_peer = requests.post(
        f"{API}/auth/login", json={"email": email, "password": "wrong"},
        headers={"X-Forwarded-For": "203.0.113.42"}, timeout=20,
    )
    assert spoofed_peer.status_code == 429


def test_admin_seed_does_not_replace_changed_password(monkeypatch):
    email = f"p0-seed-{uuid.uuid4().hex}@example.com"
    monkeypatch.setenv("ADMIN_EMAIL", email)
    monkeypatch.setenv("ADMIN_PASSWORD", "initial-test-password")
    monkeypatch.setenv("DEFAULT_RESTAURANT_NAME", f"P0 seed {uuid.uuid4().hex}")
    async def exercise():
        await seed_admin_and_restaurant()
        changed_hash = hash_password("changed-test-password")
        users = get_db().users
        await users.update_one({"email": email}, {"$set": {"password_hash": changed_hash}})
        await seed_admin_and_restaurant()
        return await users.find_one({"email": email})

    stored = asyncio.run(exercise())
    assert verify_password("changed-test-password", stored["password_hash"])
    assert not verify_password("initial-test-password", stored["password_hash"])


def test_status_write_rejects_concurrent_change(monkeypatch):
    class Orders:
        async def find_one(self, query, projection=None):
            return {"status": "in_preparation"}

        async def find_one_and_update(self, query, update, **kwargs):
            assert query["status"] == "in_preparation"
            return None  # another action changed status before this write

    class Db:
        orders = Orders()

    monkeypatch.setattr(order_routes, "get_db", lambda: Db())
    with pytest.raises(HTTPException) as error:
        asyncio.run(order_routes.change_status(
            "order-1", OrderStatusInput(status="ready"),
            Tenant({"id": "user-1", "restaurant_id": "restaurant-1", "role": "kitchen"}),
        ))
    assert error.value.status_code == 409


def test_custom_permissions_and_optional_password_change():
    tenant_id = uuid.uuid4().hex[:24]
    now = int(time.time())
    handoff = jwt.encode({
        "sub": f"tenant_user:{uuid.uuid4().hex}", "restaurant_id": tenant_id,
        "role": "admin", "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
        "exp": now + 60, "jti": uuid.uuid4().hex, "handoff_version": 1,
        "hub_access": {"user": 1, "tenant": 1, "module": 1},
    }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")
    session = requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=20)
    assert session.status_code == 200, session.text[:200]
    admin = session.json()
    admin_headers = {"Authorization": f"Bearer {admin['token']}"}

    catalog = requests.get(f"{API}/users/permissions", headers=admin_headers, timeout=20)
    assert catalog.status_code == 200, catalog.text[:200]
    assert set(catalog.json()["presets"]) == {"admin", "manager", "waiter", "kitchen"}
    assert "dashboard.metrics" in catalog.json()["presets"]["manager"]
    assert "dashboard.metrics" not in catalog.json()["presets"]["waiter"]
    assert "users.manage" in admin["user"]["permissions"]

    # A custom permission list overrides the role preset and is read from the DB
    # on every request, rather than being copied into the access token.
    custom_email = f"custom-{uuid.uuid4().hex}@example.com"
    custom_password = "custom-password-1"
    created = requests.post(f"{API}/users", headers=admin_headers, timeout=20, json={
        "name": "Custom permission user", "email": custom_email,
        "temp_password": custom_password, "role": "kitchen",
        "permissions": ["products.view"],
    })
    assert created.status_code == 201, created.text[:200]
    assert created.json()["must_change_password"] is False
    login = requests.post(f"{API}/auth/login", timeout=20, json={
        "email": custom_email, "password": custom_password,
    })
    assert login.status_code == 200, login.text[:200]
    custom_headers = {"Authorization": f"Bearer {login.json()['token']}"}
    assert requests.get(f"{API}/products", headers=custom_headers, timeout=20).status_code == 200
    assert requests.get(f"{API}/orders", headers=custom_headers, timeout=20).status_code == 403

    updated = requests.put(
        f"{API}/users/{created.json()['id']}", headers=admin_headers, timeout=20,
        json={"name": "Custom permission user", "role": "kitchen", "active": True,
              "permissions": ["orders.view"]},
    )
    assert updated.status_code == 200, updated.text[:200]
    assert requests.get(f"{API}/products", headers=custom_headers, timeout=20).status_code == 403
    assert requests.get(f"{API}/orders", headers=custom_headers, timeout=20).status_code == 200

    reset_default = requests.post(
        f"{API}/users/{created.json()['id']}/reset-password", headers=admin_headers, timeout=20,
        json={"new_temp_password": "reset-password-1"},
    )
    assert reset_default.status_code == 200, reset_default.text[:200]
    assert reset_default.json()["must_change_password"] is False
    reset_forced = requests.post(
        f"{API}/users/{created.json()['id']}/reset-password", headers=admin_headers, timeout=20,
        json={"new_temp_password": "reset-password-2", "require_password_change": True},
    )
    assert reset_forced.status_code == 200, reset_forced.text[:200]
    assert reset_forced.json()["must_change_password"] is True
    assert requests.get(f"{API}/orders", headers=custom_headers, timeout=20).status_code == 403
    reset_unlocked = requests.post(
        f"{API}/users/{created.json()['id']}/reset-password", headers=admin_headers, timeout=20,
        json={"new_temp_password": "reset-password-3"},
    )
    assert reset_unlocked.status_code == 200, reset_unlocked.text[:200]
    assert requests.get(f"{API}/orders", headers=custom_headers, timeout=20).status_code == 200

    # Omitting permissions preserves backward compatibility through the role preset.
    forced_email = f"forced-{uuid.uuid4().hex}@example.com"
    forced_password = "temporary-password-1"
    forced = requests.post(f"{API}/users", headers=admin_headers, timeout=20, json={
        "name": "Preset user", "email": forced_email, "temp_password": forced_password,
        "role": "waiter", "require_password_change": True,
    })
    assert forced.status_code == 201, forced.text[:200]
    assert forced.json()["must_change_password"] is True
    assert "orders.create" in forced.json()["permissions"]
    forced_login = requests.post(f"{API}/auth/login", timeout=20, json={
        "email": forced_email, "password": forced_password,
    })
    assert forced_login.status_code == 200, forced_login.text[:200]
    forced_headers = {"Authorization": f"Bearer {forced_login.json()['token']}"}
    locked = requests.get(f"{API}/orders", headers=forced_headers, timeout=20)
    assert locked.status_code == 403
    assert locked.json()["detail"] == "Troca de senha obrigatória"
    changed = requests.post(f"{API}/auth/change-password", headers=forced_headers, timeout=20, json={
        "current_password": forced_password, "new_password": "permanent-password-1",
    })
    assert changed.status_code == 200, changed.text[:200]
    assert requests.get(f"{API}/orders", headers=forced_headers, timeout=20).status_code == 200

    # The sole users.manage holder cannot remove that capability from itself.
    protected = requests.put(
        f"{API}/users/{admin['user']['id']}", headers=admin_headers, timeout=20,
        json={"name": admin["user"]["name"], "role": "admin", "active": True,
              "permissions": ["users.view"]},
    )
    assert protected.status_code == 409


def test_custom_roles_are_tenant_scoped_and_safe_to_edit_or_delete():
    def admin_session(tenant_id):
        now = int(time.time())
        handoff = jwt.encode({
            "sub": f"tenant_user:{uuid.uuid4().hex}", "restaurant_id": tenant_id,
            "role": "admin", "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
            "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
            "exp": now + 60, "jti": uuid.uuid4().hex, "handoff_version": 1,
            "hub_access": {"user": 1, "tenant": 1, "module": 1},
        }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")
        response = requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=20)
        assert response.status_code == 200, response.text[:200]
        return {"Authorization": f"Bearer {response.json()['token']}"}

    tenant_a, tenant_b = uuid.uuid4().hex[:24], uuid.uuid4().hex[:24]
    headers_a, headers_b = admin_session(tenant_a), admin_session(tenant_b)
    created_role = requests.post(f"{API}/users/custom-roles", headers=headers_a, timeout=20, json={
        "name": "Garçom", "permissions": ["orders.view", "orders.create"],
    })
    assert created_role.status_code == 201, created_role.text[:200]
    custom_role = created_role.json()
    assert [item["id"] for item in requests.get(f"{API}/users/custom-roles", headers=headers_a, timeout=20).json()] == [custom_role["id"]]
    assert requests.get(f"{API}/users/custom-roles", headers=headers_b, timeout=20).json() == []

    # The same display name is valid in another restaurant, but cross-tenant use is not.
    same_name = requests.post(f"{API}/users/custom-roles", headers=headers_b, timeout=20, json={
        "name": "Garçom", "permissions": ["customers.view"],
    })
    assert same_name.status_code == 201, same_name.text[:200]
    foreign_user = requests.post(f"{API}/users", headers=headers_b, timeout=20, json={
        "name": "Foreign role", "email": f"foreign-{uuid.uuid4().hex}@example.com",
        "temp_password": "password-1", "role": "admin", "custom_role_id": custom_role["id"],
    })
    assert foreign_user.status_code == 404

    assigned = requests.post(f"{API}/users", headers=headers_a, timeout=20, json={
        "name": "Assigned role", "email": f"assigned-{uuid.uuid4().hex}@example.com",
        "temp_password": "password-1", "role": "admin", "custom_role_id": custom_role["id"],
    })
    assert assigned.status_code == 201, assigned.text[:200]
    assigned_user = assigned.json()
    assert assigned_user["role"] == "waiter"
    assert assigned_user["custom_role_id"] == custom_role["id"]
    assert set(assigned_user["permissions"]) == {"orders.view", "orders.create"}
    assigned_login = requests.post(f"{API}/auth/login", timeout=20, json={
        "email": assigned_user["email"], "password": "password-1",
    })
    assert assigned_login.status_code == 200, assigned_login.text[:200]
    assert assigned_login.json()["user"]["custom_role_name"] == "Garçom"

    edited_role = requests.put(
        f"{API}/users/custom-roles/{custom_role['id']}", headers=headers_a, timeout=20,
        json={"name": "Garçom salão", "permissions": ["orders.view"]},
    )
    assert edited_role.status_code == 200, edited_role.text[:200]
    listed_user = next(item for item in requests.get(f"{API}/users", headers=headers_a, timeout=20).json()
                       if item["id"] == assigned_user["id"])
    assert set(listed_user["permissions"]) == {"orders.view", "orders.create"}
    assert requests.delete(
        f"{API}/users/custom-roles/{custom_role['id']}", headers=headers_a, timeout=20,
    ).status_code == 409

    detached = requests.put(f"{API}/users/{assigned_user['id']}", headers=headers_a, timeout=20, json={
        "name": "Assigned role", "role": "waiter", "custom_role_id": None,
        "active": True, "permissions": ["orders.view"],
    })
    assert detached.status_code == 200, detached.text[:200]
    assert detached.json()["custom_role_id"] is None
    assert requests.delete(
        f"{API}/users/custom-roles/{custom_role['id']}", headers=headers_a, timeout=20,
    ).status_code == 204
