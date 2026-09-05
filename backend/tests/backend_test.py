"""DACOT Orders — handoff cross-tenant isolation & RBAC security tests (public URL)."""
import concurrent.futures
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


class TestAuthenticatedTenantBinding:
    def test_token_restaurant_id_must_match_user_record(self):
        sess = exchange(sign_handoff(ALPHA, "admin"))
        assert sess.status_code == 200, sess.text[:200]
        token = sess.json()["token"]
        payload = pyjwt.decode(token, backend_env.get("JWT_SECRET"), algorithms=["HS256"])
        forged = pyjwt.encode({**payload, "restaurant_id": BETA}, backend_env.get("JWT_SECRET"), algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {forged}"}, timeout=20)
        assert r.status_code == 401, f"token com tenant divergente aceito: {r.status_code} {r.text[:200]}"

    def test_token_role_must_match_user_record(self):
        sess = exchange(sign_handoff(ALPHA, "admin"))
        assert sess.status_code == 200, sess.text[:200]
        token = sess.json()["token"]
        payload = pyjwt.decode(token, backend_env.get("JWT_SECRET"), algorithms=["HS256"])
        forged = pyjwt.encode({**payload, "role": "waiter"}, backend_env.get("JWT_SECRET"), algorithm="HS256")
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {forged}"}, timeout=20)
        assert r.status_code == 401, f"token com role divergente aceito: {r.status_code} {r.text[:200]}"

    def test_orders_session_exchange_compat_contract(self):
        handoff = sign_handoff(ALPHA, "admin", sub_id="hub-compat", restaurant_slug="padaria-grao-dourado")
        r = requests.post(f"{API}/orders/session/exchange", json={"handoff": handoff}, timeout=20)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["ok"] is True
        assert body["session_token"] == body["token"]
        assert body["user"]["restaurant_id"] == ALPHA
        assert body["user"]["restaurant_slug"] == "padaria-grao-dourado"


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


# ---------------- Regression: order_number allocation under concurrency ----------------
class TestOrderNumberConcurrency:
    """Guards against the read-max-then-insert race in _next_order_number
    (two near-simultaneous POST /orders could previously be handed the same
    order_number and one would blow up with a raw 500 on the unique index)."""

    def test_concurrent_order_creation_gets_unique_sequential_numbers(self):
        tenant_id = f"tenant-race-{uuid.uuid4().hex[:8]}"
        r = exchange(sign_handoff(tenant_id, "admin"))
        assert r.status_code == 200, r.text[:300]
        headers = {"Authorization": f"Bearer {r.json()['token']}"}

        p = requests.post(
            f"{API}/products",
            json={"name": "TEST_Race", "price": 10, "category": "TEST_C", "active": True},
            headers=headers, timeout=20,
        )
        assert p.status_code == 201, p.text[:300]
        product_id = p.json()["id"]

        n = 20

        def create_order(_):
            return requests.post(
                f"{API}/orders",
                json={"items": [{"product_id": product_id, "quantity": 1}]},
                headers=headers, timeout=20,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=n) as pool:
            responses = list(pool.map(create_order, range(n)))

        statuses = [resp.status_code for resp in responses]
        assert statuses.count(201) == n, f"esperava {n} pedidos criados (201), status recebidos: {statuses}"

        order_numbers = sorted(resp.json()["order_number"] for resp in responses)
        assert len(set(order_numbers)) == n, f"order_number duplicado sob concorrência: {order_numbers}"
        # tenant novo e exclusivo para este teste: a sequência deve começar em 1001 e ser contígua
        assert order_numbers == list(range(1001, 1001 + n)), f"sequência quebrada: {order_numbers}"


# ---------------- Kitchen role: status rollback ----------------
class TestKitchenStatusRollback:
    """Kitchen (KDS) can advance new->in_preparation->ready and roll either step back,
    but must never reach the terminal states delivered/cancelled."""

    @pytest.fixture(scope="class")
    def tenant_id(self):
        return f"tenant-kitchen-{uuid.uuid4().hex[:8]}"

    @pytest.fixture(scope="class")
    def admin_h(self, tenant_id):
        r = exchange(sign_handoff(tenant_id, "admin"))
        assert r.status_code == 200, r.text[:200]
        return {"Authorization": f"Bearer {r.json()['token']}"}

    @pytest.fixture(scope="class")
    def kitchen_h(self, tenant_id):
        r = exchange(sign_handoff(tenant_id, "kitchen"))
        assert r.status_code == 200, r.text[:200]
        return {"Authorization": f"Bearer {r.json()['token']}"}

    @pytest.fixture(scope="class")
    def product_id(self, admin_h):
        p = requests.post(f"{API}/products", json={"name": "TEST_Kitchen", "price": 9, "category": "TEST_C", "active": True},
                          headers=admin_h, timeout=20)
        assert p.status_code == 201, p.text[:200]
        return p.json()["id"]

    def _new_order(self, admin_h, product_id):
        o = requests.post(f"{API}/orders", json={"items": [{"product_id": product_id, "quantity": 1}]}, headers=admin_h, timeout=20)
        assert o.status_code == 201, o.text[:200]
        return o.json()["id"]

    def _set_status(self, headers, order_id, status):
        return requests.patch(f"{API}/orders/{order_id}/status", json={"status": status}, headers=headers, timeout=20)

    def test_kitchen_new_to_in_preparation_allowed(self, admin_h, kitchen_h, product_id):
        oid = self._new_order(admin_h, product_id)
        r = self._set_status(kitchen_h, oid, "in_preparation")
        assert r.status_code == 200, r.text[:200]
        assert r.json()["status"] == "in_preparation"

    def test_kitchen_in_preparation_to_ready_allowed(self, admin_h, kitchen_h, product_id):
        oid = self._new_order(admin_h, product_id)
        assert self._set_status(kitchen_h, oid, "in_preparation").status_code == 200
        r = self._set_status(kitchen_h, oid, "ready")
        assert r.status_code == 200, r.text[:200]
        assert r.json()["status"] == "ready"

    def test_kitchen_ready_to_in_preparation_rollback_allowed(self, admin_h, kitchen_h, product_id):
        oid = self._new_order(admin_h, product_id)
        assert self._set_status(kitchen_h, oid, "in_preparation").status_code == 200
        assert self._set_status(kitchen_h, oid, "ready").status_code == 200
        r = self._set_status(kitchen_h, oid, "in_preparation")
        assert r.status_code == 200, r.text[:200]
        assert r.json()["status"] == "in_preparation"

    def test_kitchen_in_preparation_to_new_rollback_allowed(self, admin_h, kitchen_h, product_id):
        oid = self._new_order(admin_h, product_id)
        assert self._set_status(kitchen_h, oid, "in_preparation").status_code == 200
        r = self._set_status(kitchen_h, oid, "new")
        assert r.status_code == 200, r.text[:200]
        assert r.json()["status"] == "new"

    def test_kitchen_cannot_mark_delivered(self, admin_h, kitchen_h, product_id):
        oid = self._new_order(admin_h, product_id)
        assert self._set_status(kitchen_h, oid, "in_preparation").status_code == 200
        assert self._set_status(kitchen_h, oid, "ready").status_code == 200
        r = self._set_status(kitchen_h, oid, "delivered")
        assert r.status_code == 403, r.text[:200]

    def test_kitchen_cannot_cancel(self, admin_h, kitchen_h, product_id):
        oid = self._new_order(admin_h, product_id)
        r = self._set_status(kitchen_h, oid, "cancelled")
        assert r.status_code == 403, r.text[:200]

    def test_ready_to_new_still_rejected_for_kitchen(self, admin_h, kitchen_h, product_id):
        """Kitchen's expanded target set includes "new", but ALLOWED_TRANSITIONS still
        forbids skipping straight from ready to new — only in_preparation->new is a rollback."""
        oid = self._new_order(admin_h, product_id)
        assert self._set_status(kitchen_h, oid, "in_preparation").status_code == 200
        assert self._set_status(kitchen_h, oid, "ready").status_code == 200
        r = self._set_status(kitchen_h, oid, "new")
        assert r.status_code == 409, r.text[:200]

    def test_other_roles_unaffected_waiter_can_still_deliver_and_cancel(self, tenant_id, admin_h, product_id):
        r = exchange(sign_handoff(tenant_id, "waiter"))
        assert r.status_code == 200, r.text[:200]
        waiter_h = {"Authorization": f"Bearer {r.json()['token']}"}

        oid = self._new_order(admin_h, product_id)
        assert self._set_status(waiter_h, oid, "in_preparation").status_code == 200
        assert self._set_status(waiter_h, oid, "ready").status_code == 200
        assert self._set_status(waiter_h, oid, "delivered").status_code == 200

        oid2 = self._new_order(admin_h, product_id)
        assert self._set_status(waiter_h, oid2, "cancelled").status_code == 200


# ---------------- KDS elapsed-time indicator: updated_at must track status entry ----------------
class TestOrderStatusTimestampForElapsedIndicator:
    """The KDS elapsed-time indicator times `in_preparation`/`ready` off `updated_at`.
    That's only correct if `updated_at` is touched exclusively by real status
    transitions (PATCH .../status) and never by a content edit (PUT /orders/{id})."""

    @pytest.fixture(scope="class")
    def tenant_id(self):
        return f"tenant-timer-{uuid.uuid4().hex[:8]}"

    @pytest.fixture(scope="class")
    def admin_h(self, tenant_id):
        r = exchange(sign_handoff(tenant_id, "admin"))
        assert r.status_code == 200, r.text[:200]
        return {"Authorization": f"Bearer {r.json()['token']}"}

    @pytest.fixture(scope="class")
    def product_id(self, admin_h):
        p = requests.post(f"{API}/products", json={"name": "TEST_Timer", "price": 7, "category": "TEST_C", "active": True},
                          headers=admin_h, timeout=20)
        assert p.status_code == 201, p.text[:200]
        return p.json()["id"]

    def _new_order(self, admin_h, product_id):
        o = requests.post(f"{API}/orders", json={"items": [{"product_id": product_id, "quantity": 1}]}, headers=admin_h, timeout=20)
        assert o.status_code == 201, o.text[:200]
        return o.json()

    def test_new_order_updated_at_equals_created_at(self, admin_h, product_id):
        order = self._new_order(admin_h, product_id)
        assert order["updated_at"] == order["created_at"]

    def test_status_transition_advances_updated_at(self, admin_h, product_id):
        order = self._new_order(admin_h, product_id)
        r = requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "in_preparation"}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        updated = r.json()
        assert updated["updated_at"] != order["updated_at"]
        assert updated["created_at"] == order["created_at"], "created_at nunca deve mudar"

    def test_editing_order_in_preparation_does_not_touch_updated_at(self, admin_h, product_id):
        """Regression for the KDS timer bug: editing an order's items while it's
        in_preparation must NOT reset the "time in this stage" indicator."""
        order = self._new_order(admin_h, product_id)
        r1 = requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "in_preparation"}, headers=admin_h, timeout=20)
        assert r1.status_code == 200, r1.text[:200]
        in_prep_updated_at = r1.json()["updated_at"]

        edit = requests.put(f"{API}/orders/{order['id']}", json={
            "items": [{"product_id": product_id, "quantity": 2}],
            "notes": "cliente pediu para trocar a quantidade",
        }, headers=admin_h, timeout=20)
        assert edit.status_code == 200, edit.text[:200]
        assert edit.json()["updated_at"] == in_prep_updated_at, "editar o pedido nao deve mexer em updated_at (zeraria o cronometro da cozinha)"
        assert edit.json()["items"][0]["quantity"] == 2, "a edicao em si deve ter sido aplicada normalmente"

    def test_editing_order_still_new_does_not_touch_updated_at(self, admin_h, product_id):
        order = self._new_order(admin_h, product_id)
        edit = requests.put(f"{API}/orders/{order['id']}", json={
            "items": [{"product_id": product_id, "quantity": 3}],
            "notes": "",
        }, headers=admin_h, timeout=20)
        assert edit.status_code == 200, edit.text[:200]
        assert edit.json()["updated_at"] == order["updated_at"]
        assert edit.json()["updated_at"] == edit.json()["created_at"]

    def test_ready_reached_updates_timestamp_and_rollback_resets_it_again(self, admin_h, product_id):
        order = self._new_order(admin_h, product_id)
        requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "in_preparation"}, headers=admin_h, timeout=20)
        r_ready = requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "ready"}, headers=admin_h, timeout=20)
        assert r_ready.status_code == 200
        ready_at = r_ready.json()["updated_at"]

        r_back = requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "in_preparation"}, headers=admin_h, timeout=20)
        assert r_back.status_code == 200
        assert r_back.json()["updated_at"] != ready_at, "voltar para Em preparo deve reiniciar o cronometro dessa etapa"


# ---------------- Customer order history (GET /orders?customer_id=) ----------------
class TestOrdersFilteredByCustomer:
    """Powers the customer detail dialog's order history. Must return only that
    customer's orders, scoped to the caller's own tenant — never another tenant's
    data, regardless of which customer_id is requested."""

    @pytest.fixture(scope="class")
    def tenant_id(self):
        return f"tenant-custhist-{uuid.uuid4().hex[:8]}"

    @pytest.fixture(scope="class")
    def admin_h(self, tenant_id):
        r = exchange(sign_handoff(tenant_id, "admin"))
        assert r.status_code == 200, r.text[:200]
        return {"Authorization": f"Bearer {r.json()['token']}"}

    @pytest.fixture(scope="class")
    def product_id(self, admin_h):
        p = requests.post(f"{API}/products", json={"name": "TEST_CustHist", "price": 15, "category": "TEST_C", "active": True},
                          headers=admin_h, timeout=20)
        assert p.status_code == 201, p.text[:200]
        return p.json()["id"]

    @pytest.fixture(scope="class")
    def two_customers(self, admin_h):
        c1 = requests.post(f"{API}/customers", json={"name": "TEST_Cliente1", "phone": "111", "notes": ""}, headers=admin_h, timeout=20)
        c2 = requests.post(f"{API}/customers", json={"name": "TEST_Cliente2", "phone": "222", "notes": ""}, headers=admin_h, timeout=20)
        assert c1.status_code == 201, c1.text[:200]
        assert c2.status_code == 201, c2.text[:200]
        return c1.json(), c2.json()

    def test_returns_only_that_customers_orders(self, admin_h, product_id, two_customers):
        c1, c2 = two_customers
        o1 = requests.post(f"{API}/orders", json={"customer_id": c1["id"], "items": [{"product_id": product_id, "quantity": 1}]}, headers=admin_h, timeout=20)
        o2 = requests.post(f"{API}/orders", json={"customer_id": c2["id"], "items": [{"product_id": product_id, "quantity": 2}]}, headers=admin_h, timeout=20)
        assert o1.status_code == 201, o1.text[:200]
        assert o2.status_code == 201, o2.text[:200]

        r = requests.get(f"{API}/orders", params={"customer_id": c1["id"]}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        ids = [o["id"] for o in r.json()]
        assert o1.json()["id"] in ids
        assert o2.json()["id"] not in ids

    def test_customer_with_no_orders_returns_empty_list(self, admin_h):
        c = requests.post(f"{API}/customers", json={"name": "TEST_SemPedido", "phone": "", "notes": ""}, headers=admin_h, timeout=20).json()
        r = requests.get(f"{API}/orders", params={"customer_id": c["id"]}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json() == []

    def test_history_includes_cancelled_orders(self, admin_h, product_id, two_customers):
        c1, _ = two_customers
        o = requests.post(f"{API}/orders", json={"customer_id": c1["id"], "items": [{"product_id": product_id, "quantity": 1}]}, headers=admin_h, timeout=20).json()
        cancel = requests.post(f"{API}/orders/{o['id']}/cancel", headers=admin_h, timeout=20)
        assert cancel.status_code == 200, cancel.text[:200]

        r = requests.get(f"{API}/orders", params={"customer_id": c1["id"]}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        status_by_id = {x["id"]: x["status"] for x in r.json()}
        assert status_by_id.get(o["id"]) == "cancelled", "historico deve incluir pedidos cancelados, nao so ativos"

    def test_foreign_tenant_customer_id_returns_empty_not_other_tenant_orders(self, admin_h, beta_data):
        """Passing another tenant's real customer_id must never leak that tenant's orders."""
        r = requests.get(f"{API}/orders", params={"customer_id": beta_data["customer"]["id"]}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json() == [], "customer_id de outro tenant nao pode retornar pedidos de outro tenant"


# ---------------- Global search: GET /products?search= ----------------
class TestProductsSearch:
    """Powers the products group of the global search. Must match by name,
    case-insensitively, scoped to the caller's own tenant."""

    @pytest.fixture(scope="class")
    def tenant_id(self):
        return f"tenant-prodsearch-{uuid.uuid4().hex[:8]}"

    @pytest.fixture(scope="class")
    def admin_h(self, tenant_id):
        r = exchange(sign_handoff(tenant_id, "admin"))
        assert r.status_code == 200, r.text[:200]
        return {"Authorization": f"Bearer {r.json()['token']}"}

    @pytest.fixture(scope="class")
    def seeded_products(self, admin_h):
        burger = requests.post(f"{API}/products", json={"name": "TEST_X-Burger", "price": 25, "category": "TEST_C", "active": True}, headers=admin_h, timeout=20)
        fries = requests.post(f"{API}/products", json={"name": "TEST_Batata Frita", "price": 12, "category": "TEST_C", "active": True}, headers=admin_h, timeout=20)
        assert burger.status_code == 201, burger.text[:200]
        assert fries.status_code == 201, fries.text[:200]
        return burger.json(), fries.json()

    def test_search_matches_by_name_case_insensitive(self, admin_h, seeded_products):
        burger, fries = seeded_products
        r = requests.get(f"{API}/products", params={"search": "x-burger"}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        ids = [p["id"] for p in r.json()]
        assert burger["id"] in ids
        assert fries["id"] not in ids

    def test_search_with_no_match_returns_empty_list(self, admin_h, seeded_products):
        r = requests.get(f"{API}/products", params={"search": "TEST_NaoExiste_xyz"}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert r.json() == []

    def test_foreign_tenant_product_never_appears(self, admin_h, beta_data):
        """A product name that only exists in another tenant must never surface here."""
        r = requests.get(f"{API}/products", params={"search": "TEST_Segredo B"}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        assert all(p["id"] != beta_data["product"]["id"] for p in r.json()), "produto de outro tenant nao pode aparecer na busca"


# ---------------- Order timeline: delivered_at exposure ----------------
class TestOrderDeliveredAtExposure:
    """delivered_at already existed in the DB (written by change_status) but was never
    returned by the API — the order timeline needs it to show the delivery event."""

    @pytest.fixture(scope="class")
    def tenant_id(self):
        return f"tenant-timeline-{uuid.uuid4().hex[:8]}"

    @pytest.fixture(scope="class")
    def admin_h(self, tenant_id):
        r = exchange(sign_handoff(tenant_id, "admin"))
        assert r.status_code == 200, r.text[:200]
        return {"Authorization": f"Bearer {r.json()['token']}"}

    @pytest.fixture(scope="class")
    def product_id(self, admin_h):
        p = requests.post(f"{API}/products", json={"name": "TEST_Timeline", "price": 11, "category": "TEST_C", "active": True},
                          headers=admin_h, timeout=20)
        assert p.status_code == 201, p.text[:200]
        return p.json()["id"]

    def _new_order(self, admin_h, product_id):
        o = requests.post(f"{API}/orders", json={"items": [{"product_id": product_id, "quantity": 1}]}, headers=admin_h, timeout=20)
        assert o.status_code == 201, o.text[:200]
        return o.json()

    def test_fresh_order_has_no_delivered_at(self, admin_h, product_id):
        """Compatibility check: an order never delivered (same response shape as an old
        record predating this field) must return delivered_at as null, never error."""
        order = self._new_order(admin_h, product_id)
        assert order["delivered_at"] is None

    def test_delivered_order_returns_delivered_at_and_keeps_created_at(self, admin_h, product_id):
        order = self._new_order(admin_h, product_id)
        requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "in_preparation"}, headers=admin_h, timeout=20)
        requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "ready"}, headers=admin_h, timeout=20)
        r = requests.patch(f"{API}/orders/{order['id']}/status", json={"status": "delivered"}, headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        delivered = r.json()
        assert delivered["status"] == "delivered"
        assert delivered["delivered_at"] is not None
        assert delivered["created_at"] == order["created_at"], "created_at nunca deve mudar"

        fetched = requests.get(f"{API}/orders/{order['id']}", headers=admin_h, timeout=20)
        assert fetched.status_code == 200, fetched.text[:200]
        assert fetched.json()["delivered_at"] == delivered["delivered_at"], "GET deve devolver o mesmo delivered_at de forma consistente"

    def test_cancelled_order_keeps_cancelled_at_and_null_delivered_at(self, admin_h, product_id):
        order = self._new_order(admin_h, product_id)
        r = requests.post(f"{API}/orders/{order['id']}/cancel", headers=admin_h, timeout=20)
        assert r.status_code == 200, r.text[:200]
        cancelled = r.json()
        assert cancelled["status"] == "cancelled"
        assert cancelled["cancelled_at"] is not None
        assert cancelled["delivered_at"] is None
