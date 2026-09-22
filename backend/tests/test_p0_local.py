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
    tenant_id = f"tenant-p0-revenue-{uuid.uuid4().hex[:8]}"
    now = int(time.time())
    handoff = jwt.encode({
        "sub": f"tenant_user:{uuid.uuid4().hex}", "restaurant_id": tenant_id,
        "role": "admin", "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
        "exp": now + 60, "jti": uuid.uuid4().hex, "handoff_version": 1,
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
