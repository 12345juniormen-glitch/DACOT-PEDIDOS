"""DACOT Orders — handoff cross-tenant isolation & RBAC security tests (public URL)."""
import os
import time
import uuid

import jwt as pyjwt
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = base_url.rstrip("/") + "/api"

SECRET = backend_env.get("HANDOFF_JWT_SECRET")
ISS = backend_env.get("HANDOFF_ISSUER")
AUD = backend_env.get("HANDOFF_AUDIENCE")
ADMIN_EMAIL = backend_env.get("ADMIN_EMAIL")
ADMIN_PASSWORD = backend_env.get("ADMIN_PASSWORD")

ALPHA = "tenant-alpha"
BETA = "tenant-beta"


def sign_handoff(restaurant_id, role="admin", sub_id=None, secret=None, **over):
    now = int(time.time())
    claims = {
        "sub": f"tenant_user:{sub_id or 'hub-' + uuid.uuid4().hex[:8]}",
        "restaurant_id": restaurant_id,
        "role": role,
        "module": "orders",
        "iss": ISS,
        "aud": AUD,
        "iat": now,
        "nbf": now - 5,
        "exp": now + 60,
        "jti": uuid.uuid4().hex,
        "handoff_version": 1,
    }
    claims.update(over)
    return pyjwt.encode(claims, secret or SECRET, algorithm="HS256")


def exchange(handoff):
    return requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=20)


@pytest.fixture(scope="session")
def session_alpha():
    r = exchange(sign_handoff(ALPHA, "admin"))
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="session")
def session_beta():
    r = exchange(sign_handoff(BETA, "admin"))
    assert r.status_code == 200, r.text[:300]
    return r.json()


@pytest.fixture(scope="session")
def H_A(session_alpha):
    return {"Authorization": f"Bearer {session_alpha['token']}"}


@pytest.fixture(scope="session")
def H_B(session_beta):
    return {"Authorization": f"Bearer {session_beta['token']}"}


@pytest.fixture(scope="session")
def beta_data(H_B):
    """Seed private data in tenant-beta."""
    p = requests.post(f"{API}/products", json={"name": "TEST_Segredo B", "price": 42, "category": "TEST_C", "active": True}, headers=H_B, timeout=20)
    assert p.status_code == 201, p.text[:300]
    prod = p.json()
    c = requests.post(f"{API}/customers", json={"name": "TEST_Cliente B", "phone": "1199999999", "notes": ""}, headers=H_B, timeout=20)
    assert c.status_code == 201, c.text[:300]
    cust = c.json()
    o = requests.post(f"{API}/orders", json={"items": [{"product_id": prod["id"], "quantity": 1}]}, headers=H_B, timeout=20)
    assert o.status_code == 201, o.text[:300]
    return {"product": prod, "customer": cust, "order": o.json()}


# ---------------- Handoff session claims ----------------
class TestHandoffSession:
    def test_session_carries_jwt_restaurant_and_role(self, session_alpha, H_A):
        u = session_alpha["user"]
        assert u["restaurant_id"] == ALPHA
        assert u["role"] == "admin"
        me = requests.get(f"{API}/auth/me", headers=H_A, timeout=20)
        assert me.status_code == 200
        body = me.json()
        assert body["restaurant_id"] == ALPHA
        assert body["role"] == "admin"
        assert "_id" not in body and "password_hash" not in body

    def test_waiter_handoff_role_preserved(self):
        r = exchange(sign_handoff(ALPHA, "waiter"))
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "waiter"

    def test_replay_rejected(self):
        tok = sign_handoff(ALPHA, "admin")
        first = exchange(tok)
        assert first.status_code == 200
        second = exchange(tok)
        assert second.status_code == 401, second.text[:200]
        assert "replay" in second.json()["detail"].lower()

    def test_tampered_signature_rejected(self):
        r = exchange(sign_handoff(BETA, "admin", secret="wrong-secret-wrong-secret-wrong!"))
        assert r.status_code == 401

    def test_alg_none_rejected(self):
        now = int(time.time())
        tok = pyjwt.encode({"sub": "tenant_user:x", "restaurant_id": BETA, "role": "admin", "module": "orders",
                            "iss": ISS, "aud": AUD, "iat": now, "nbf": now - 5, "exp": now + 60,
                            "jti": uuid.uuid4().hex, "handoff_version": 1}, key="", algorithm="none")
        r = exchange(tok)
        assert r.status_code == 401

    def test_bad_issuer_audience_role_module(self):
        assert exchange(sign_handoff(ALPHA, iss="evil")).status_code == 401
        assert exchange(sign_handoff(ALPHA, aud="other-app")).status_code == 401
        assert exchange(sign_handoff(ALPHA, role="superadmin")).status_code == 401
        assert exchange(sign_handoff(ALPHA, module="billing")).status_code == 401
        assert exchange(sign_handoff(ALPHA, handoff_version=2)).status_code == 401

    def test_expired_rejected(self):
        now = int(time.time())
        assert exchange(sign_handoff(ALPHA, exp=now - 10, iat=now - 100, nbf=now - 100)).status_code == 401

    def test_inactive_tenant_module_rejected(self):
        r = exchange(sign_handoff("inactive-t1", "admin"))
        assert r.status_code == 403, r.text[:200]

    def test_unknown_tenant_rejected(self):
        r = exchange(sign_handoff("unknown-t1", "admin"))
        assert r.status_code in (403, 404), r.text[:200]


# ---------------- Cross-tenant isolation ----------------
class TestCrossTenantIsolation:
    def test_get_beta_resources_with_alpha_token(self, H_A, beta_data):
        for path in (f"orders/{beta_data['order']['id']}", f"products/{beta_data['product']['id']}",
                     f"customers/{beta_data['customer']['id']}"):
            r = requests.get(f"{API}/{path}", headers=H_A, timeout=20)
            assert r.status_code == 404, f"{path} -> {r.status_code} {r.text[:200]}"

    def test_lists_do_not_leak_beta(self, H_A, beta_data):
        for res, key in (("orders", "order"), ("products", "product"), ("customers", "customer")):
            r = requests.get(f"{API}/{res}", headers=H_A, timeout=20)
            assert r.status_code == 200
            items = r.json()
            assert all(i["id"] != beta_data[key]["id"] for i in items)
            for i in items:
                if "restaurant_id" in i:
                    assert i["restaurant_id"] == ALPHA

    def test_mutations_on_beta_resources_blocked(self, H_A, beta_data):
        oid, pid, cid = beta_data["order"]["id"], beta_data["product"]["id"], beta_data["customer"]["id"]
        checks = [
            ("patch", f"orders/{oid}/status", {"status": "in_preparation"}),
            ("post", f"orders/{oid}/cancel", None),
            ("post", f"orders/{oid}/duplicate", None),
            ("put", f"orders/{oid}", {"items": [{"product_id": pid, "quantity": 3}]}),
            ("put", f"products/{pid}", {"name": "HACK", "price": 1, "category": "C", "active": True}),
            ("delete", f"products/{pid}", None),
            ("put", f"customers/{cid}", {"name": "HACK", "phone": "1", "notes": ""}),
        ]
        for method, path, body in checks:
            r = getattr(requests, method)(f"{API}/{path}", json=body, headers=H_A, timeout=20)
            assert r.status_code == 404, f"{method.upper()} {path} -> {r.status_code} {r.text[:200]}"

    def test_beta_data_untouched_after_attacks(self, H_B, beta_data):
        r = requests.get(f"{API}/products/{beta_data['product']['id']}", headers=H_B, timeout=20)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Segredo B"
        o = requests.get(f"{API}/orders/{beta_data['order']['id']}", headers=H_B, timeout=20)
        assert o.status_code == 200
        assert o.json()["status"] == beta_data["order"]["status"]

    def test_alpha_cannot_use_beta_product_in_new_order(self, H_A, beta_data):
        r = requests.post(f"{API}/orders", json={"items": [{"product_id": beta_data["product"]["id"], "quantity": 1}]},
                          headers=H_A, timeout=20)
        assert r.status_code in (400, 404, 422), f"{r.status_code} {r.text[:200]}"

    def test_users_list_scoped_to_tenant(self, H_A):
        r = requests.get(f"{API}/users", headers=H_A, timeout=20)
        assert r.status_code == 200
        assert all(u.get("restaurant_id", ALPHA) == ALPHA for u in r.json())

    def test_restaurant_current_is_alpha(self, H_A):
        r = requests.get(f"{API}/restaurant/current", headers=H_A, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json()["id"] == ALPHA

    def test_restaurant_current_isolated_between_tenants(self, H_A, H_B):
        a = requests.get(f"{API}/restaurant/current", headers=H_A, timeout=20).json()
        b = requests.get(f"{API}/restaurant/current", headers=H_B, timeout=20).json()
        assert a["id"] == ALPHA and b["id"] == BETA


# ---------------- restaurant_id injection ----------------
class TestRestaurantIdInjection:
    def test_body_restaurant_id_ignored_on_product_create(self, H_A, H_B):
        r = requests.post(f"{API}/products", json={"name": "TEST_Injecao", "price": 1, "category": "TEST_C",
                                                  "active": True, "restaurant_id": BETA}, headers=H_A, timeout=20)
        assert r.status_code == 201, r.text[:200]
        pid = r.json()["id"]
        assert requests.get(f"{API}/products/{pid}", headers=H_A, timeout=20).status_code == 200
        assert requests.get(f"{API}/products/{pid}", headers=H_B, timeout=20).status_code == 404

    def test_body_restaurant_id_ignored_on_customer_and_order(self, H_A, H_B):
        c = requests.post(f"{API}/customers", json={"name": "TEST_InjC", "phone": "1188", "notes": "", "restaurant_id": BETA},
                          headers=H_A, timeout=20)
        assert c.status_code == 201
        assert requests.get(f"{API}/customers/{c.json()['id']}", headers=H_B, timeout=20).status_code == 404
        p = requests.post(f"{API}/products", json={"name": "TEST_PA", "price": 5, "category": "TEST_C", "active": True},
                          headers=H_A, timeout=20).json()
        o = requests.post(f"{API}/orders", json={"items": [{"product_id": p["id"], "quantity": 1}], "restaurant_id": BETA},
                          headers=H_A, timeout=20)
        assert o.status_code == 201
        assert requests.get(f"{API}/orders/{o.json()['id']}", headers=H_B, timeout=20).status_code == 404

    def test_querystring_restaurant_id_ignored(self, H_A, beta_data):
        for res, key in (("orders", "order"), ("products", "product"), ("customers", "customer")):
            r = requests.get(f"{API}/{res}?restaurant_id={BETA}", headers=H_A, timeout=20)
            assert r.status_code == 200
            assert all(i["id"] != beta_data[key]["id"] for i in r.json())

    def test_header_spoof_ignored(self, H_A, beta_data):
        h = dict(H_A)
        h.update({"X-Restaurant-Id": BETA, "X-Tenant-Id": BETA})
        r = requests.get(f"{API}/orders", headers=h, timeout=20)
        assert r.status_code == 200
        assert all(i["id"] != beta_data["order"]["id"] for i in r.json())


# ---------------- RBAC / role escalation ----------------
class TestRoleEscalation:
    @pytest.fixture(scope="class")
    def waiter(self):
        r = exchange(sign_handoff(ALPHA, "waiter"))
        assert r.status_code == 200
        data = r.json()
        return {"h": {"Authorization": f"Bearer {data['token']}"}, "user": data["user"]}

    def test_waiter_cannot_create_admin_user(self, waiter):
        r = requests.post(f"{API}/users", json={"name": "TEST_Hack", "email": "test_hack@x.app",
                                                "temp_password": "tempaaa1", "role": "admin"},
                          headers=waiter["h"], timeout=20)
        assert r.status_code == 403, r.text[:200]

    def test_waiter_cannot_promote_self(self, waiter):
        r = requests.put(f"{API}/users/{waiter['user']['id']}", json={"name": "self", "role": "admin", "active": True},
                         headers=waiter["h"], timeout=20)
        assert r.status_code == 403
        me = requests.get(f"{API}/auth/me", headers=waiter["h"], timeout=20).json()
        assert me["role"] == "waiter"

    def test_waiter_cannot_read_stats_or_users(self, waiter):
        assert requests.get(f"{API}/orders/stats", headers=waiter["h"], timeout=20).status_code == 403
        assert requests.get(f"{API}/users", headers=waiter["h"], timeout=20).status_code == 403

    def test_change_password_extra_role_field_ignored(self, waiter):
        r = requests.post(f"{API}/auth/change-password",
                          json={"current_password": "x", "new_password": "newpasses1", "role": "admin"},
                          headers=waiter["h"], timeout=20)
        assert r.status_code in (400, 401, 422), r.text[:200]
        me = requests.get(f"{API}/auth/me", headers=waiter["h"], timeout=20).json()
        assert me["role"] == "waiter"

    def test_handoff_user_cannot_login_locally(self, waiter):
        r = requests.post(f"{API}/auth/login", json={"email": waiter["user"]["email"], "password": ""}, timeout=20)
        assert r.status_code in (400, 401, 422), r.text[:200]

    def test_no_auth_and_bad_token_rejected(self):
        assert requests.get(f"{API}/orders", timeout=20).status_code == 401
        assert requests.get(f"{API}/orders", headers={"Authorization": "Bearer garbage"}, timeout=20).status_code == 401
        # handoff token itself must not be usable as a session token
        tok = sign_handoff(ALPHA, "admin")
        assert requests.get(f"{API}/orders", headers={"Authorization": f"Bearer {tok}"}, timeout=20).status_code == 401


# ---------------- Regression: local admin login ----------------
class TestLocalAdminRegression:
    def test_admin_login_and_scope(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["user"]["role"] == "admin"
        assert data["user"]["restaurant_id"] not in (ALPHA, BETA)
        h = {"Authorization": f"Bearer {data['token']}"}
        me = requests.get(f"{API}/auth/me", headers=h, timeout=20)
        assert me.status_code == 200
        assert me.json()["email"] == ADMIN_EMAIL
        assert requests.get(f"{API}/orders/stats", headers=h, timeout=20).status_code == 200

    def test_admin_cannot_see_handoff_tenant_data(self, beta_data):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=20)
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        assert requests.get(f"{API}/products/{beta_data['product']['id']}", headers=h, timeout=20).status_code == 404
        lst = requests.get(f"{API}/orders", headers=h, timeout=20).json()
        assert all(o["id"] != beta_data["order"]["id"] for o in lst)

    def test_wrong_password_rejected(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "definitely-wrong"}, timeout=20)
        assert r.status_code in (400, 401, 429), r.text[:200]
