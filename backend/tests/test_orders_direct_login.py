"""Unit coverage for the Hub-backed Pedidos login migration path.

These tests use only in-memory fakes for the Hub boundary.  Existing local
integration tests continue covering MongoDB indexes and handoff concurrency.
"""
import asyncio
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from core import hub_access
from modules.auth import routes as auth_routes
from modules.auth.routes import LoginInput
from modules.handoff import routes as handoff_routes


TENANT = "a" * 24
HUB_USER = "c" * 24
EMAIL = "employee@example.test"
PASSWORD = "correct-password"


def _identity(**overrides):
    result = {
        "contract_version": 1,
        "user_id": HUB_USER,
        "restaurant_id": TENANT,
        "name": "Funcionário",
        "email": EMAIL,
        "module": "orders",
        "role": "waiter",
        "access_versions": {"user": 3, "tenant": 5, "module": 7},
    }
    result.update(overrides)
    return result


def _request():
    return Request({"type": "http", "method": "POST", "path": "/api/auth/login", "client": ("127.0.0.1", 1234), "headers": []})


class _Attempts:
    async def find_one_and_update(self, _query, _update, **_kwargs):
        return {"count": 1}


class _Db:
    def __init__(self, user=None):
        self.user = user
        self.login_attempts = _Attempts()
        self.custom_roles = SimpleNamespace(find_one=self._no_role)

    async def _no_role(self, *_args, **_kwargs):
        return None

    @property
    def users(self):
        return SimpleNamespace(find_one=self._find_user)

    async def _find_user(self, query, *_args, **_kwargs):
        if self.user and query == {"email": EMAIL}:
            return self.user.copy()
        return None


@pytest.fixture(autouse=True)
def _direct_login_env(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "j" * 48)
    monkeypatch.setenv("MODULE_API_KEY", "m" * 48)
    monkeypatch.delenv("HUB_MODULE_KEY", raising=False)
    monkeypatch.setenv("HUB_BASE_URL", "https://hub.example.test")
    monkeypatch.setenv("ORDERS_DIRECT_LOGIN_ENABLED", "true")


def test_hub_contract_is_strict_and_binds_the_requested_email():
    assert hub_access._validate_direct_login_contract(_identity(), EMAIL) == _identity()
    with pytest.raises(ValueError):
        hub_access._validate_direct_login_contract(_identity(extra=True), EMAIL)
    with pytest.raises(ValueError):
        hub_access._validate_direct_login_contract(_identity(email="other@example.test"), EMAIL)
    with pytest.raises(ValueError):
        hub_access._validate_direct_login_contract(_identity(access_versions={"user": 1}), EMAIL)


class _HubResponse:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


class _HubClient:
    response = _HubResponse(200, _identity())
    calls = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url, **kwargs):
        self.__class__.calls.append((url, kwargs, self.kwargs))
        return self.__class__.response


def test_direct_hub_request_uses_only_the_fixed_service_contract(monkeypatch):
    _HubClient.calls = []
    _HubClient.response = _HubResponse(200, _identity())
    monkeypatch.setattr(hub_access.httpx, "AsyncClient", _HubClient)
    result = asyncio.run(hub_access.authenticate_orders_direct_login(EMAIL, PASSWORD))
    assert result == _identity()
    assert _HubClient.calls == [(
        "https://hub.example.test/api/internal/modules/orders/direct-login/v1",
        {"headers": {"X-Module-Key": "m" * 48}, "json": {"email": EMAIL, "password": PASSWORD}},
        {"timeout": 5.0, "follow_redirects": False, "trust_env": False},
    )]


def test_direct_hub_rejections_and_failures_are_fail_closed(monkeypatch):
    monkeypatch.setattr(hub_access.httpx, "AsyncClient", _HubClient)
    _HubClient.response = _HubResponse(401, {})
    assert asyncio.run(hub_access.authenticate_orders_direct_login(EMAIL, PASSWORD)) is None

    _HubClient.response = _HubResponse(200, _identity(extra=True))
    with pytest.raises(HTTPException) as malformed:
        asyncio.run(hub_access.authenticate_orders_direct_login(EMAIL, PASSWORD))
    assert malformed.value.status_code == 503

    _HubClient.response = _HubResponse(200, _identity(access_versions={"user": 1}))
    with pytest.raises(HTTPException) as malformed_context:
        asyncio.run(hub_access.authenticate_orders_direct_login(EMAIL, PASSWORD))
    assert malformed_context.value.status_code == 503

    _HubClient.response = _HubResponse(429, {})
    with pytest.raises(HTTPException) as limited:
        asyncio.run(hub_access.authenticate_orders_direct_login(EMAIL, PASSWORD))
    assert limited.value.status_code == 429


def test_direct_login_feature_is_default_off(monkeypatch):
    monkeypatch.delenv("ORDERS_DIRECT_LOGIN_ENABLED", raising=False)
    assert auth_routes._orders_direct_login_enabled() is False


def test_feature_off_preserves_historical_hub_login(monkeypatch):
    from core.security import hash_password

    monkeypatch.delenv("ORDERS_DIRECT_LOGIN_ENABLED", raising=False)
    db = _Db({
        "id": "local-hub-user", "email": EMAIL, "name": "Histórico", "role": "waiter",
        "restaurant_id": TENANT, "hub_user_id": HUB_USER, "password_hash": hash_password(PASSWORD),
        "active": True, "provisioned_by": "hub",
    })
    monkeypatch.setattr(auth_routes, "get_db", lambda: db)

    async def access_context(*args):
        assert args == (TENANT, HUB_USER, "waiter")
        return {"user": 1, "tenant": 2, "module": 3}

    async def must_not_contact_direct_hub(*_args, **_kwargs):
        raise AssertionError("direct login is disabled")

    monkeypatch.setattr(auth_routes, "fetch_hub_access_context", access_context)
    monkeypatch.setattr(auth_routes, "authenticate_orders_direct_login", must_not_contact_direct_hub)
    result = asyncio.run(auth_routes.login(LoginInput(email=EMAIL, password=PASSWORD), _request()))
    assert result.user.id == "local-hub-user"


def test_hub_managed_user_never_falls_back_when_hub_is_unavailable(monkeypatch):
    db = _Db({
        "id": "local-hub-user", "email": EMAIL, "name": "Old", "role": "waiter",
        "restaurant_id": TENANT, "hub_user_id": HUB_USER, "password_hash": "not-used",
        "active": True, "provisioned_by": "hub_direct_login",
    })
    monkeypatch.setattr(auth_routes, "get_db", lambda: db)

    async def unavailable(*_args, **_kwargs):
        raise HTTPException(503, "hub unavailable")

    monkeypatch.setattr(auth_routes, "authenticate_orders_direct_login", unavailable)
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth_routes.login(LoginInput(email=EMAIL, password=PASSWORD), _request()))
    assert error.value.status_code == 503


@pytest.mark.parametrize("denial", ["invalid_password", "inactive_user", "suspended_tenant", "module_disabled", "grant_revoked"])
def test_hub_denials_keep_one_generic_response(monkeypatch, denial):
    db = _Db()
    monkeypatch.setattr(auth_routes, "get_db", lambda: db)

    async def denied(*_args, **_kwargs):
        return None

    monkeypatch.setattr(auth_routes, "authenticate_orders_direct_login", denied)
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth_routes.login(LoginInput(email=EMAIL, password=PASSWORD), _request()))
    assert error.value.status_code == 401
    assert error.value.detail == "Email ou senha inválidos"


def test_legacy_user_stays_local_and_does_not_contact_hub(monkeypatch):
    from core.security import hash_password

    db = _Db({
        "id": "legacy-user", "email": EMAIL, "name": "Legado", "role": "waiter",
        "restaurant_id": TENANT, "password_hash": hash_password(PASSWORD), "active": True,
        "account_origin": "legacy",
    })
    monkeypatch.setattr(auth_routes, "get_db", lambda: db)

    async def should_not_run(*_args, **_kwargs):
        raise AssertionError("legacy login must not contact Hub")

    monkeypatch.setattr(auth_routes, "authenticate_orders_direct_login", should_not_run)
    result = asyncio.run(auth_routes.login(LoginInput(email=EMAIL, password=PASSWORD), _request()))
    assert result.user.id == "legacy-user"


def test_direct_login_uses_hub_identity_and_existing_session_format(monkeypatch):
    db = _Db()
    calls = {}
    monkeypatch.setattr(auth_routes, "get_db", lambda: db)

    async def hub_login(email, password):
        assert (email, password) == (EMAIL, PASSWORD)
        return _identity()

    async def restaurant(restaurant_id):
        calls["restaurant"] = restaurant_id

    async def mirror(restaurant_id, hub_user_id, role, **kwargs):
        calls["mirror"] = (restaurant_id, hub_user_id, role, kwargs)
        return {
            "id": "local-hub-user", "restaurant_id": restaurant_id, "hub_user_id": hub_user_id,
            "email": kwargs["email"], "name": kwargs["name"], "role": role,
            "permissions": ["orders.create"], "active": True, "account_origin": "hub",
        }

    monkeypatch.setattr(auth_routes, "authenticate_orders_direct_login", hub_login)
    monkeypatch.setattr(auth_routes, "_find_or_create_restaurant", restaurant)
    monkeypatch.setattr(auth_routes, "_find_or_create_user", mirror)
    result = asyncio.run(auth_routes.login(LoginInput(email=EMAIL, password=PASSWORD), _request()))
    assert calls["restaurant"] == TENANT
    assert calls["mirror"][0:3] == (TENANT, HUB_USER, "waiter")
    assert calls["mirror"][3]["provisioned_by"] == "hub_direct_login"
    assert result.user.restaurant_id == TENANT
    assert result.user.email == EMAIL


class _MirrorUsers:
    def __init__(self):
        self.items = []

    async def find_one(self, query, *_args, **_kwargs):
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                return item.copy()
        return None

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        if await self.find_one({"restaurant_id": doc["restaurant_id"], "hub_user_id": doc["hub_user_id"]}):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("duplicate mirror")
        if await self.find_one({"email": doc["email"]}):
            from pymongo.errors import DuplicateKeyError
            raise DuplicateKeyError("duplicate email")
        self.items.append(doc.copy())

    async def update_one(self, query, update, *_args, **_kwargs):
        for item in self.items:
            if all(item.get(key) == value for key, value in query.items()):
                item.update(update.get("$set", {}))
                for key in update.get("$unset", {}):
                    item.pop(key, None)
                return


def test_direct_mirror_is_idempotent_under_concurrency_and_never_stores_a_hub_password(monkeypatch):
    users = _MirrorUsers()
    monkeypatch.setattr(handoff_routes, "get_db", lambda: SimpleNamespace(users=users))

    async def exercise():
        simultaneous = await asyncio.gather(*[
            handoff_routes._find_or_create_user(
                TENANT, HUB_USER, "waiter", name="Funcionário", email=EMAIL,
                provisioned_by="hub_direct_login",
            ) for _ in range(8)
        ])
        updated = await handoff_routes._find_or_create_user(
            TENANT, HUB_USER, "manager", name="Atualizado", email=EMAIL,
            provisioned_by="hub_direct_login",
        )
        return simultaneous, updated

    simultaneous, updated = asyncio.run(exercise())
    assert {user["id"] for user in simultaneous} == {updated["id"]}
    assert len(users.items) == 1
    assert users.items[0]["id"] == updated["id"]
    assert users.items[0]["role"] == "manager"
    assert "password_hash" not in users.items[0]
    assert users.items[0]["account_origin"] == "hub"


def test_direct_mirror_does_not_cross_restaurant_boundaries(monkeypatch):
    users = _MirrorUsers()
    monkeypatch.setattr(handoff_routes, "get_db", lambda: SimpleNamespace(users=users))

    async def exercise():
        first = await handoff_routes._find_or_create_user(
            TENANT, HUB_USER, "waiter", name="A", email="a@example.test",
            provisioned_by="hub_direct_login",
        )
        second = await handoff_routes._find_or_create_user(
            "b" * 24, "hub-user-2", "waiter", name="B", email="b@example.test",
            provisioned_by="hub_direct_login",
        )
        return first, second

    first, second = asyncio.run(exercise())
    assert first["restaurant_id"] == TENANT
    assert second["restaurant_id"] == "b" * 24
    assert first["id"] != second["id"]
