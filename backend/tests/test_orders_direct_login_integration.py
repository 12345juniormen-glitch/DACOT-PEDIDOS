"""Real-Mongo integration coverage for Hub-backed Pedidos direct login.

Runs only through ``run_local_integration.py``.  Its Hub simulator implements
the exact versioned service boundary, while MongoDB and the Pedidos API are
real loopback processes.
"""
import concurrent.futures
import os
import threading
import uuid

import pytest
import requests
from pymongo import MongoClient


pytestmark = pytest.mark.skipif(
    os.environ.get("DACOT_LOCAL_INTEGRATION") != "1"
    or not os.environ.get("REACT_APP_BACKEND_URL", "").startswith("http://127.0.0.1:"),
    reason="Only the disposable loopback integration runner may run these tests",
)

API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"
HUB = os.environ.get("HUB_BASE_URL", "").rstrip("/")
CONTROL_KEY = os.environ.get("WHATSAPP_TEST_CONTROL_SECRET", "")
PASSWORD = "direct-login-test-password"


def _identity(email, *, tenant=None, user=None, role="waiter"):
    return {
        "contract_version": 1,
        "user_id": user or uuid.uuid4().hex[:24],
        "restaurant_id": tenant or uuid.uuid4().hex[:24],
        "name": "Funcionário de Teste",
        "email": email,
        "module": "orders",
        "role": role,
        "access_versions": {"user": 1, "tenant": 1, "module": 1},
    }


def _configure(email, identity=None, *, mode="success", password=PASSWORD, access_active=True):
    payload = {"email": email, "mode": mode, "password": password, "access_active": access_active}
    if identity is not None:
        payload["identity"] = identity
    response = requests.post(
        f"{HUB}/test/direct-login/configure", json=payload,
        headers={"X-Test-Control": CONTROL_KEY}, timeout=10,
    )
    assert response.status_code == 200, response.text


def _set_access(identity, active):
    response = requests.post(
        f"{HUB}/test/direct-login/access-state",
        json={"restaurant_id": identity["restaurant_id"], "subject": f"tenant_user:{identity['user_id']}", "active": active},
        headers={"X-Test-Control": CONTROL_KEY}, timeout=10,
    )
    assert response.status_code == 200, response.text


def _login(email, password=PASSWORD):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)


def _direct_provision(identity, *, tenant_name=None):
    payload = {
        "tenant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"],
        "name": identity["name"], "email": identity["email"], "role": identity["role"],
    }
    if tenant_name is not None:
        payload["tenant_name"] = tenant_name
    return requests.post(
        f"{API}/internal/hub/provision/direct/v1",
        json=payload,
        headers={"X-Module-Key": os.environ["MODULE_API_KEY"]}, timeout=15,
    )


def _db():
    return MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _bound_restaurant(tenant_id):
    _db().restaurants.insert_one({
        "id": tenant_id, "hub_tenant_id": tenant_id, "name": "Restaurante de teste",
    })


def test_direct_login_creates_passwordless_mirror_and_operational_session():
    email = f"direct-{uuid.uuid4().hex}@example.com"
    identity = _identity(email)
    _configure(email, identity)

    response = _login(email)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["restaurant_id"] == identity["restaurant_id"]
    assert body["user"]["role"] == identity["role"]
    assert "password_hash" not in body
    assert "password_hash" not in body["user"]

    user = _db().users.find_one({"restaurant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"]})
    assert user and user["account_origin"] == "hub"
    assert user["provisioned_by"] == "hub_direct_login"
    assert "password_hash" not in user
    assert _db().restaurants.count_documents({"id": identity["restaurant_id"]}) == 1

    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {body['token']}"}, timeout=10)
    assert me.status_code == 200, me.text


def test_early_direct_provision_is_passwordless_idempotent_and_needs_module_key():
    identity = _identity(f"prepared-{uuid.uuid4().hex}@example.com")
    # Omitting the explicit tenant name retains the pre-bound requirement.
    assert _direct_provision(identity).status_code == 404

    missing_key = requests.post(
        f"{API}/internal/hub/provision/direct/v1",
        json={"tenant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"],
              "name": identity["name"], "email": identity["email"], "role": identity["role"]}, timeout=15,
    )
    assert missing_key.status_code == 401
    invalid_key = requests.post(
        f"{API}/internal/hub/provision/direct/v1",
        json={"tenant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"],
              "name": identity["name"], "email": identity["email"], "role": identity["role"]},
        headers={"X-Module-Key": "invalid"}, timeout=15,
    )
    assert invalid_key.status_code == 401

    first = _direct_provision(identity, tenant_name="Restaurante Hub de teste")
    second = _direct_provision(identity, tenant_name="Restaurante Hub de teste")
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == {"ok": True}
    restaurant = _db().restaurants.find_one({"id": identity["restaurant_id"]})
    assert restaurant and restaurant["hub_tenant_id"] == identity["restaurant_id"]
    user = _db().users.find_one({"restaurant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"]})
    assert user and user["provisioned_by"] == "hub_direct_login"
    assert "password_hash" not in user
    assert not user.get("must_change_password")
    assert _db().first_access_tokens.count_documents({"user_id": user["id"]}) == 0


def test_concurrent_early_provision_creates_one_mirror_and_never_adopts_legacy_email():
    identity = _identity(f"prepared-parallel-{uuid.uuid4().hex}@example.com")
    _bound_restaurant(identity["restaurant_id"])
    barrier = threading.Barrier(8)

    def attempt(_index):
        barrier.wait(timeout=10)
        return _direct_provision(identity)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(attempt, range(8)))
    assert [response.status_code for response in responses] == [200] * 8
    assert _db().users.count_documents({"restaurant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"]}) == 1

    legacy_email = f"legacy-provision-{uuid.uuid4().hex}@example.com"
    _db().users.insert_one({
        "id": uuid.uuid4().hex, "restaurant_id": uuid.uuid4().hex[:24], "email": legacy_email,
        "name": "Legado", "role": "waiter", "active": True, "account_origin": "legacy", "password_hash": "",
    })
    collision = _identity(legacy_email)
    _bound_restaurant(collision["restaurant_id"])
    assert _direct_provision(collision).status_code == 409
    assert _db().users.count_documents({"hub_user_id": collision["user_id"]}) == 0


def test_early_provision_preserves_only_valid_waiter_custom_role():
    identity = _identity(f"prepared-custom-{uuid.uuid4().hex}@example.com", role="waiter")
    _bound_restaurant(identity["restaurant_id"])
    assert _direct_provision(identity).status_code == 200
    custom_role = {
        "id": str(uuid.uuid4()), "restaurant_id": identity["restaurant_id"],
        "name": "Garçom líder", "name_key": "garçom líder", "permissions": ["orders.view"],
    }
    _db().custom_roles.insert_one(custom_role)
    assert requests.put(
        f"{API}/internal/hub/users/{identity['user_id']}/custom-role/v1",
        json={"tenant_id": identity["restaurant_id"], "custom_role_id": custom_role["id"]},
        headers={"X-Module-Key": os.environ["MODULE_API_KEY"]}, timeout=15,
    ).status_code == 200

    assert _direct_provision(identity).status_code == 200
    assert _db().users.find_one({"hub_user_id": identity["user_id"]})["custom_role_id"] == custom_role["id"]

    identity["role"] = "manager"
    assert _direct_provision(identity).status_code == 200
    updated = _db().users.find_one({"hub_user_id": identity["user_id"]})
    assert updated["role"] == "manager" and "custom_role_id" not in updated


@pytest.mark.parametrize("reason", ["invalid_credentials", "inactive_user", "suspended_tenant", "module_disabled", "grant_revoked"])
def test_hub_authorization_denials_are_generic_and_fail_closed(reason):
    email = f"denied-{reason}-{uuid.uuid4().hex}@example.com"
    identity = _identity(email)
    _configure(email, identity, mode="deny")

    response = _login(email)
    assert response.status_code == 401
    assert "password" not in response.text.lower()
    assert _db().users.count_documents({"hub_user_id": identity["user_id"]}) == 0


@pytest.mark.parametrize("mode", ["malformed", "server_error", "disconnect"])
def test_hub_failures_are_fail_closed(mode):
    email = f"failure-{mode}-{uuid.uuid4().hex}@example.com"
    identity = _identity(email)
    _configure(email, identity, mode=mode)

    response = _login(email)
    assert response.status_code == 503
    assert "password" not in response.text.lower()
    assert _db().users.count_documents({"hub_user_id": identity["user_id"]}) == 0


def test_invalid_password_and_revoked_authority_do_not_issue_or_keep_access():
    email = f"revoked-{uuid.uuid4().hex}@example.com"
    identity = _identity(email)
    _configure(email, identity)
    assert _login(email, "wrong-password").status_code == 401

    login = _login(email)
    assert login.status_code == 200, login.text
    _set_access(identity, False)
    revoked = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {login.json()['token']}"}, timeout=10)
    assert revoked.status_code == 403


def test_concurrent_direct_logins_create_one_real_mongo_mirror():
    email = f"parallel-{uuid.uuid4().hex}@example.com"
    identity = _identity(email)
    _configure(email, identity)
    barrier = threading.Barrier(8)

    def attempt(_index):
        barrier.wait(timeout=10)
        return _login(email)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(attempt, range(8)))

    assert [response.status_code for response in responses] == [200] * 8
    ids = {response.json()["user"]["id"] for response in responses}
    assert len(ids) == 1
    assert _db().users.count_documents({"restaurant_id": identity["restaurant_id"], "hub_user_id": identity["user_id"]}) == 1
    assert _db().restaurants.count_documents({"id": identity["restaurant_id"]}) == 1


def test_existing_mirror_keeps_operational_id_and_history_when_hub_profile_changes():
    email = f"history-{uuid.uuid4().hex}@example.com"
    identity = _identity(email, role="waiter")
    _configure(email, identity)
    first = _login(email)
    assert first.status_code == 200, first.text
    local_id = first.json()["user"]["id"]
    _db().orders.insert_one({"id": uuid.uuid4().hex, "restaurant_id": identity["restaurant_id"], "created_by": local_id})

    identity["name"] = "Nome Atualizado"
    identity["role"] = "manager"
    _configure(email, identity)
    second = _login(email)
    assert second.status_code == 200, second.text
    assert second.json()["user"]["id"] == local_id
    stored = _db().users.find_one({"id": local_id})
    assert stored["name"] == "Nome Atualizado" and stored["role"] == "manager"
    assert _db().orders.count_documents({"restaurant_id": identity["restaurant_id"], "created_by": local_id}) == 1


def test_direct_login_refresh_preserves_a_valid_pedidos_custom_role_for_waiter():
    email = f"custom-role-{uuid.uuid4().hex}@example.com"
    identity = _identity(email, role="waiter")
    _configure(email, identity)
    first = _login(email)
    assert first.status_code == 200, first.text
    local_id = first.json()["user"]["id"]
    custom_role = {
        "id": str(uuid.uuid4()),
        "restaurant_id": identity["restaurant_id"],
        "name": "Atendimento limitado",
        "name_key": "atendimento limitado",
        "permissions": ["orders.view", "service.view"],
    }
    _db().custom_roles.insert_one(custom_role)
    assigned = requests.put(
        f"{API}/internal/hub/users/{identity['user_id']}/custom-role/v1",
        json={"tenant_id": identity["restaurant_id"], "custom_role_id": custom_role["id"]},
        headers={"X-Module-Key": os.environ["MODULE_API_KEY"]}, timeout=10,
    )
    assert assigned.status_code == 200, assigned.text

    # Existing Pedidos sessions load the authoritative user document on each
    # request, so an operational role change takes effect without minting a
    # second session or retaining the old permission set.
    current = requests.get(
        f"{API}/auth/me", headers={"Authorization": f"Bearer {first.json()['token']}"}, timeout=10,
    )
    assert current.status_code == 200, current.text
    assert current.json()["permissions"] == custom_role["permissions"]

    refreshed = _login(email)
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["user"]["id"] == local_id
    assert refreshed.json()["user"]["custom_role_id"] == custom_role["id"]
    assert _db().users.find_one({"id": local_id})["custom_role_id"] == custom_role["id"]


def test_legacy_email_collision_is_never_adopted_as_a_hub_identity():
    email = f"legacy-{uuid.uuid4().hex}@example.com"
    legacy_id = uuid.uuid4().hex
    legacy_tenant = uuid.uuid4().hex[:24]
    _db().users.insert_one({
        "id": legacy_id, "restaurant_id": legacy_tenant, "email": email,
        "name": "Legado", "role": "waiter", "active": True,
        "account_origin": "legacy", "password_hash": "",
    })
    # A network-level failure would yield 503 if Pedidos attempted to route a
    # legacy record through the Hub.  It must instead remain a local generic 401.
    _configure(email, _identity(email), mode="disconnect")
    denied = _login(email, "not-a-local-password")
    assert denied.status_code == 401
    legacy = _db().users.find_one({"id": legacy_id})
    assert legacy["restaurant_id"] == legacy_tenant and "hub_user_id" not in legacy
