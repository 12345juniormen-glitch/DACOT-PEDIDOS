"""Real-Mongo coverage for the HUB-to-Pedidos custom-role service contract.

These tests only run through ``run_local_integration.py``.  They exercise the
Pedidos HTTP API and an ephemeral MongoDB instance; no HUB, restaurant or
credential from any deployed environment is involved.
"""
import concurrent.futures
import os
import threading
import uuid

import pytest
import requests
from pymongo import MongoClient

from core.permissions import permissions_for_role


pytestmark = pytest.mark.skipif(
    os.environ.get("DACOT_LOCAL_INTEGRATION") != "1"
    or not os.environ.get("REACT_APP_BACKEND_URL", "").startswith("http://127.0.0.1:"),
    reason="Only the disposable loopback integration runner may run these tests",
)

API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _key_headers():
    return {"X-Module-Key": os.environ["MODULE_API_KEY"]}


def _tenant_id():
    return uuid.uuid4().hex[:24]


def _seed_restaurant(tenant_id: str):
    _db().restaurants.insert_one({
        "id": tenant_id,
        "hub_tenant_id": tenant_id,
        "name": "Restaurante de Teste",
        "provisioned_by": "hub",
    })


def _seed_hub_user(tenant_id: str, *, role="waiter"):
    hub_user_id = uuid.uuid4().hex[:24]
    user = {
        "id": str(uuid.uuid4()),
        "hub_user_id": hub_user_id,
        "restaurant_id": tenant_id,
        "email": f"hub-role-{uuid.uuid4().hex}@example.com",
        "name": "Funcionário HUB",
        "role": role,
        "permissions": permissions_for_role(role),
        # This test exercises identity refresh rather than first-access
        # invitation delivery; avoid generating an invitation token at all.
        "password_hash": "test-only-existing-local-marker",
        "active": True,
        "account_origin": "hub",
        "provisioned_by": "hub_direct_login",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    _db().users.insert_one(user)
    return user


def _seed_custom_role(tenant_id: str, *, permissions=None):
    role = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant_id,
        "name": "Atendimento limitado",
        "name_key": "atendimento limitado",
        "permissions": permissions or ["orders.view", "service.view"],
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
    }
    _db().custom_roles.insert_one(role)
    return role


def _custom_role_url(hub_user_id: str):
    return f"{API}/internal/hub/users/{hub_user_id}/custom-role/v1"


def test_custom_role_contract_requires_service_authentication_and_scopes_every_tenant():
    tenant_a, tenant_b = _tenant_id(), _tenant_id()
    _seed_restaurant(tenant_a)
    _seed_restaurant(tenant_b)
    user_a = _seed_hub_user(tenant_a)
    role_a = _seed_custom_role(tenant_a)
    role_b = _seed_custom_role(tenant_b)

    missing = requests.get(f"{API}/internal/hub/custom-roles/v1", params={"tenant_id": tenant_a}, timeout=10)
    invalid = requests.get(
        f"{API}/internal/hub/custom-roles/v1",
        params={"tenant_id": tenant_a},
        headers={"X-Module-Key": "invalid"},
        timeout=10,
    )
    assert missing.status_code == invalid.status_code == 401

    listed = requests.get(
        f"{API}/internal/hub/custom-roles/v1",
        params={"tenant_id": tenant_a}, headers=_key_headers(), timeout=10,
    )
    assert listed.status_code == 200, listed.text
    assert listed.json() == {"custom_roles": [{"id": role_a["id"], "name": role_a["name"]}]}
    assert "permissions" not in listed.text
    assert role_b["id"] not in listed.text

    unassigned = requests.get(
        _custom_role_url(user_a["hub_user_id"]),
        params={"tenant_id": tenant_a}, headers=_key_headers(), timeout=10,
    )
    assert unassigned.status_code == 200
    assert unassigned.json() == {"custom_role": None}

    missing_role = requests.put(
        _custom_role_url(user_a["hub_user_id"]),
        json={"tenant_id": tenant_a, "custom_role_id": str(uuid.uuid4())},
        headers=_key_headers(), timeout=10,
    )
    assert missing_role.status_code == 404

    cross_tenant_role = requests.put(
        _custom_role_url(user_a["hub_user_id"]),
        json={"tenant_id": tenant_a, "custom_role_id": role_b["id"]},
        headers=_key_headers(), timeout=10,
    )
    cross_tenant_user = requests.get(
        _custom_role_url(user_a["hub_user_id"]),
        params={"tenant_id": tenant_b}, headers=_key_headers(), timeout=10,
    )
    assert cross_tenant_role.status_code == cross_tenant_user.status_code == 404


def test_custom_role_assignment_removal_and_reprovisioning_preserve_only_valid_waiter_association():
    tenant_id = _tenant_id()
    _seed_restaurant(tenant_id)
    user = _seed_hub_user(tenant_id)
    role = _seed_custom_role(tenant_id)

    assigned = requests.put(
        _custom_role_url(user["hub_user_id"]),
        json={"tenant_id": tenant_id, "custom_role_id": role["id"]},
        headers=_key_headers(), timeout=10,
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json() == {"custom_role": {"id": role["id"], "name": role["name"]}}
    stored = _db().users.find_one({"id": user["id"]})
    assert stored["custom_role_id"] == role["id"]
    assert stored["permissions"] == role["permissions"]

    associated = requests.get(
        _custom_role_url(user["hub_user_id"]),
        params={"tenant_id": tenant_id}, headers=_key_headers(), timeout=10,
    )
    assert associated.status_code == 200
    assert associated.json() == {"custom_role": {"id": role["id"], "name": role["name"]}}

    # Provisioning is the existing HUB identity-sync path.  A waiter refresh
    # must retain a currently valid Pedidos-owned association.
    refreshed = requests.post(
        f"{API}/internal/hub/provision",
        json={
            "tenant_id": tenant_id,
            "tenant_name": "Restaurante de Teste",
            "hub_user_id": user["hub_user_id"],
            "email": user["email"],
            "name": "Funcionário Atualizado",
            "role": "waiter",
        },
        headers=_key_headers(), timeout=10,
    )
    assert refreshed.status_code == 200, refreshed.text
    assert _db().users.find_one({"id": user["id"]})["custom_role_id"] == role["id"]

    # A basic-role change intentionally clears the specialised operation role.
    demoted = requests.post(
        f"{API}/internal/hub/provision",
        json={
            "tenant_id": tenant_id,
            "tenant_name": "Restaurante de Teste",
            "hub_user_id": user["hub_user_id"],
            "email": user["email"],
            "name": "Funcionário Atualizado",
            "role": "manager",
        },
        headers=_key_headers(), timeout=10,
    )
    assert demoted.status_code == 200, demoted.text
    after_role_change = _db().users.find_one({"id": user["id"]})
    assert "custom_role_id" not in after_role_change
    assert after_role_change["permissions"] == permissions_for_role("manager")

    forbidden = requests.put(
        _custom_role_url(user["hub_user_id"]),
        json={"tenant_id": tenant_id, "custom_role_id": role["id"]},
        headers=_key_headers(), timeout=10,
    )
    assert forbidden.status_code == 409


def test_custom_role_updates_are_idempotent_under_real_mongo_concurrency():
    tenant_id = _tenant_id()
    _seed_restaurant(tenant_id)
    user = _seed_hub_user(tenant_id)
    role = _seed_custom_role(tenant_id)
    barrier = threading.Barrier(8)

    def assign(_index):
        barrier.wait(timeout=10)
        return requests.put(
            _custom_role_url(user["hub_user_id"]),
            json={"tenant_id": tenant_id, "custom_role_id": role["id"]},
            headers=_key_headers(), timeout=10,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(assign, range(8)))
    assert [response.status_code for response in responses] == [200] * 8
    stored = _db().users.find_one({"id": user["id"]})
    assert stored["custom_role_id"] == role["id"]
    assert stored["permissions"] == role["permissions"]

    first_removal = requests.put(
        _custom_role_url(user["hub_user_id"]),
        json={"tenant_id": tenant_id, "custom_role_id": None},
        headers=_key_headers(), timeout=10,
    )
    second_removal = requests.put(
        _custom_role_url(user["hub_user_id"]),
        json={"tenant_id": tenant_id, "custom_role_id": None},
        headers=_key_headers(), timeout=10,
    )
    assert first_removal.status_code == second_removal.status_code == 200
    assert first_removal.json() == second_removal.json() == {"custom_role": None}
    removed = _db().users.find_one({"id": user["id"]})
    assert "custom_role_id" not in removed
    assert removed["permissions"] == permissions_for_role("waiter")


def test_custom_role_contract_rejects_inactive_hub_mirrors_without_disclosing_other_tenants():
    tenant_id = _tenant_id()
    _seed_restaurant(tenant_id)
    user = _seed_hub_user(tenant_id)
    _db().users.update_one({"id": user["id"]}, {"$set": {"active": False}})

    read = requests.get(
        _custom_role_url(user["hub_user_id"]),
        params={"tenant_id": tenant_id}, headers=_key_headers(), timeout=10,
    )
    write = requests.put(
        _custom_role_url(user["hub_user_id"]),
        json={"tenant_id": tenant_id, "custom_role_id": None},
        headers=_key_headers(), timeout=10,
    )
    assert read.status_code == write.status_code == 404
