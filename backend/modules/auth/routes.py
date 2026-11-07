"""Auth models & routes: login, /me. Registration is admin-only (out of scope for MVP)."""
import hashlib
import os
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import get_db
from core.deps import get_current_user
from core.security import create_access_token, hash_password, verify_password
from core.permissions import effective_permissions
from core.hub_access import authenticate_orders_direct_login, fetch_hub_access_context
from modules.handoff.routes import _find_or_create_restaurant, _find_or_create_user


UserRole = Literal["admin", "manager", "waiter", "kitchen"]


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordInput(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)


class FirstAccessInput(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    password: str = Field(min_length=6, max_length=128)


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: UserRole
    custom_role_id: Optional[str] = None
    custom_role_name: Optional[str] = None
    permissions: list[str] = Field(default_factory=list)
    restaurant_id: str
    must_change_password: bool = False
    active: bool = True
    created_at: Optional[datetime] = None


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


router = APIRouter(prefix="/auth", tags=["auth"])


def _orders_direct_login_enabled() -> bool:
    """Keep the migration path inert until both services are enabled together."""
    return os.environ.get("ORDERS_DIRECT_LOGIN_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }


def _is_hub_managed_user(user: dict | None) -> bool:
    return bool(user and (
        user.get("hub_user_id")
        or user.get("account_origin") == "hub"
        or user.get("provisioned_by") in {"hub", "hub_handoff", "hub_direct_login"}
    ))


async def _login_response(user: dict, hub_access: dict | None = None) -> LoginResponse:
    """Issue the existing Pedidos session format for either account authority."""
    db = get_db()
    token = create_access_token(
        user_id=user["id"],
        restaurant_id=user["restaurant_id"],
        role=user.get("role", "admin"),
        email=user["email"],
        hub_access=hub_access,
    )
    user = user.copy()
    user.pop("_id", None)
    user.pop("password_hash", None)
    user.setdefault("active", True)
    user.setdefault("must_change_password", False)
    user["permissions"] = effective_permissions(user)
    if user.get("custom_role_id"):
        custom_role = await db.custom_roles.find_one(
            {"id": user["custom_role_id"], "restaurant_id": user["restaurant_id"]},
            {"_id": 0, "name": 1},
        )
        user["custom_role_name"] = custom_role.get("name") if custom_role else None
    return LoginResponse(token=token, user=UserPublic(**user))


@router.post("/first-access")
async def first_access(payload: FirstAccessInput):
    db = get_db()
    now = datetime.now(timezone.utc)
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()
    invitation = await db.first_access_tokens.find_one_and_update(
        {"token_hash": token_hash, "used": False, "expires_at": {"$gt": now}},
        {"$set": {"used": True, "used_at": now}},
        return_document=ReturnDocument.BEFORE,
    )
    if not invitation:
        raise HTTPException(400, "Convite inválido ou expirado")
    result = await db.users.update_one(
        {"id": invitation["user_id"], "restaurant_id": invitation["restaurant_id"],
         "hub_user_id": {"$exists": True}, "provisioned_by": {"$in": ["hub", "hub_handoff"]}},
        {"$set": {"password_hash": hash_password(payload.password),
                  "must_change_password": False, "updated_at": now.isoformat()}},
    )
    if result.matched_count != 1:
        raise HTTPException(400, "Convite inválido ou expirado")
    await db.first_access_tokens.update_many(
        {"user_id": invitation["user_id"], "restaurant_id": invitation["restaurant_id"], "used": False},
        {"$set": {"used": True, "invalidated_at": now}},
    )
    return {"ok": True}


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginInput, request: Request):
    db = get_db()
    email = payload.email.lower().strip()
    # Shared Mongo counters work across API workers. The account-wide bucket keeps
    # protection effective even if a proxy changes the reported client address.
    peer = request.client.host if request.client else "unknown"
    now = datetime.now(timezone.utc)
    window_seconds = 300
    bucket = int(now.timestamp()) // window_seconds
    for scope, value, maximum in (("peer", peer, 100), ("account", email, 10)):
        key = hashlib.sha256(f"{scope}:{value}:{bucket}".encode()).hexdigest()
        attempt = await db.login_attempts.find_one_and_update(
            {"_id": key},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now + timedelta(seconds=window_seconds * 2)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if attempt["count"] > maximum:
            raise HTTPException(
                status_code=429,
                detail="Muitas tentativas de login. Tente novamente em alguns minutos.",
                headers={"Retry-After": str(window_seconds - int(now.timestamp()) % window_seconds)},
            )
    user = await db.users.find_one({"email": email})

    if not _orders_direct_login_enabled():
        # Until the coordinated migration is enabled, retain the pre-existing
        # login behavior exactly, including Hub access-context refreshes for
        # historical mirrored accounts.
        if not user or not verify_password(payload.password, user.get("password_hash", "")):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")
        if not user.get("active", True):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")
        hub_access = None
        if user.get("hub_user_id"):
            hub_access = await fetch_hub_access_context(
                user["restaurant_id"], user["hub_user_id"], user.get("role", "admin")
            )
        return await _login_response(user, hub_access)

    if not user or _is_hub_managed_user(user):
        # Existing Hub mirrors and new Hub identities authenticate only through
        # the Hub.  A failure there is never retried against a local password.
        identity = await authenticate_orders_direct_login(email, payload.password)
        if not identity:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")
        try:
            await _find_or_create_restaurant(identity["restaurant_id"])
            user = await _find_or_create_user(
                identity["restaurant_id"],
                identity["user_id"],
                identity["role"],
                name=identity["name"],
                email=identity["email"],
                provisioned_by="hub_direct_login",
            )
        except DuplicateKeyError:
            # A duplicate email owned by a legacy account must not join two
            # authorities.  Do not reveal which record produced the conflict.
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")
        return await _login_response(user, identity["access_versions"])

    # A pre-existing account with no Hub marker is an explicit legacy path.
    # It is intentionally kept separate so a Hub outage cannot cause a
    # managed identity to fall back to a stale local password.
    if not user or _is_hub_managed_user(user) or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")
    if not user.get("active", True):
        # Mesma mensagem genérica de credenciais inválidas: não revela que a conta existe e está desativada.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")
    if "account_origin" not in user:
        # Existing operational accounts predate the migration.  Marking their
        # successful local login makes the authority explicit without changing
        # their identifier, password or operational history.
        await db.users.update_one(
            {"id": user["id"], "restaurant_id": user["restaurant_id"], "hub_user_id": {"$exists": False}},
            {"$set": {"account_origin": "legacy", "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        user["account_origin"] = "legacy"
    return await _login_response(user)


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    db = get_db()
    user.setdefault("active", True)
    user.setdefault("must_change_password", False)
    user["permissions"] = effective_permissions(user)
    if user.get("custom_role_id"):
        custom_role = await db.custom_roles.find_one(
            {"id": user["custom_role_id"], "restaurant_id": user["restaurant_id"]},
            {"_id": 0, "name": 1},
        )
        user["custom_role_name"] = custom_role.get("name") if custom_role else None
    return UserPublic(**user)


@router.post("/logout")
async def logout(_user: dict = Depends(get_current_user)):
    # Bearer tokens are stateless; client discards the token.
    return {"ok": True}


@router.post("/change-password")
async def change_password(payload: ChangePasswordInput, user: dict = Depends(get_current_user)):
    db = get_db()
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(payload.current_password, full["password_hash"]):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="A nova senha deve ser diferente da atual")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password_hash": hash_password(payload.new_password),
            "must_change_password": False,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True}
