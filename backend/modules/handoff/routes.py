"""Handoff exchange endpoint — receives Hub JWT and issues a local session.

Contract (Hub-side, this module trusts only the signed JWT + Hub-side status API):

- POST /api/session/exchange body: { "handoff": "<JWT>" }
- Returns: { "token": "<local session JWT>", "user": {...} }

All claims that could grant privileges (restaurant_id, role, module) come only
from the signed JWT. The frontend can pass NOTHING else that affects auth.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import jwt
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core.db import get_db
from core.security import create_access_token


ALLOWED_MODULE_IDS = {"orders", "pedidos"}
ALLOWED_ROLES = {"admin", "manager", "waiter", "kitchen"}
REQUIRED_CLAIMS = ("iss", "aud", "exp", "nbf", "iat", "jti", "sub", "restaurant_id", "role", "module", "handoff_version")


class ExchangeInput(BaseModel):
    handoff: str = Field(min_length=20, max_length=4096)


class ExchangeUser(BaseModel):
    id: str
    email: str
    name: str
    role: str
    restaurant_id: str
    restaurant_slug: str | None = None
    must_change_password: bool = False
    active: bool = True


class ExchangeResponse(BaseModel):
    ok: bool = True
    token: str
    session_token: str | None = None
    user: ExchangeUser


router = APIRouter(prefix="/session", tags=["handoff"])
compat_router = APIRouter(prefix="/orders/session", tags=["handoff"])


def _cfg(name: str, required: bool = True, default: str | None = None) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        raise HTTPException(status_code=503, detail=f"Integração Hub não configurada: {name} ausente")
    return v or ""


def _fail(msg: str, code: int = 401) -> None:
    raise HTTPException(status_code=code, detail=f"Handoff inválido: {msg}")


def _decode_handoff(token: str) -> dict[str, Any]:
    secret = _cfg("HANDOFF_JWT_SECRET")
    expected_iss = _cfg("HANDOFF_ISSUER")
    expected_aud = _cfg("HANDOFF_AUDIENCE")
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=expected_iss,
            audience=expected_aud,
            options={"require": ["exp", "iat", "nbf", "iss", "aud", "jti", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        _fail("token expirado")
    except jwt.ImmatureSignatureError:
        _fail("nbf não atingido (token ainda não é válido)")
    except jwt.InvalidIssuerError:
        _fail("issuer inválido")
    except jwt.InvalidAudienceError:
        _fail("audience inválida")
    except jwt.InvalidSignatureError:
        _fail("assinatura inválida")
    except jwt.MissingRequiredClaimError as e:
        _fail(f"claim obrigatória ausente: {e.claim}")
    except jwt.InvalidTokenError as e:
        _fail(f"token inválido ({type(e).__name__})")

    # Additional strict checks
    for c in REQUIRED_CLAIMS:
        if c not in payload:
            _fail(f"claim obrigatória ausente: {c}")

    if str(payload.get("handoff_version")) != _cfg("HANDOFF_VERSION"):
        _fail("handoff_version incompatível")

    module_id = str(payload.get("module", "")).lower()
    if module_id not in ALLOWED_MODULE_IDS:
        _fail(f"module inválido: {module_id!r}")
    # normalize expected module id
    expected_module = _cfg("HANDOFF_MODULE_ID").lower()
    if expected_module in ALLOWED_MODULE_IDS and module_id != expected_module:
        _fail(f"module '{module_id}' não corresponde ao esperado '{expected_module}'")

    role = str(payload.get("role", ""))
    if role not in ALLOWED_ROLES:
        _fail(f"role inválida: {role!r}")

    if not str(payload.get("restaurant_id", "")).strip():
        _fail("restaurant_id ausente")

    sub = str(payload.get("sub", ""))
    if not sub.startswith("tenant_user:") or len(sub) <= len("tenant_user:"):
        _fail("sub inválido (esperado tenant_user:<id>)")

    return payload


async def _consume_jti(jti: str, exp_ts: int) -> None:
    """Insert jti in a TTL-indexed collection. Duplicate → replay."""
    db = get_db()
    # TTL index is created in seed.ensure_indexes
    expires_at = datetime.fromtimestamp(exp_ts, tz=timezone.utc) + timedelta(seconds=60)
    try:
        await db.handoff_jtis.insert_one({
            "jti": jti,
            "used_at": datetime.now(timezone.utc),
            "expires_at": expires_at,
        })
    except DuplicateKeyError:
        _fail("token já utilizado (replay detectado)")


async def _check_module_active(restaurant_id: str) -> None:
    base = _cfg("HUB_BASE_URL")
    module_key = _cfg("MODULE_API_KEY")
    module_id = _cfg("HANDOFF_MODULE_ID")
    url = f"{base.rstrip('/')}/api/public/tenants/{restaurant_id}/modules/{module_id}/status"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, headers={"X-Module-Key": module_key})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"Hub inacessível: {type(e).__name__}")
    if r.status_code == 404:
        raise HTTPException(status_code=403, detail="Tenant não encontrado no Hub")
    if r.status_code == 401 or r.status_code == 403:
        raise HTTPException(status_code=503, detail="Módulo não autorizado a consultar Hub (X-Module-Key)")
    if r.status_code != 200:
        raise HTTPException(status_code=503, detail=f"Hub retornou {r.status_code}")
    data = r.json()
    if not data.get("active"):
        raise HTTPException(status_code=403, detail="Módulo Pedidos inativo para este restaurante")


async def _find_or_create_restaurant(restaurant_id: str) -> dict:
    """Auto-provision local restaurants record if missing (Hub is the source of truth)."""
    db = get_db()
    r = await db.restaurants.find_one({"id": restaurant_id}, {"_id": 0})
    if r:
        return r
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": restaurant_id,
        "name": f"Restaurante {restaurant_id[:8]}",
        "hub_tenant_id": restaurant_id,
        "created_at": now,
        "provisioned_by": "hub_handoff",
    }
    await db.restaurants.insert_one(doc)
    return doc


async def _find_or_create_user(restaurant_id: str, hub_user_id: str, role: str) -> dict:
    """Find or create a local user mirrored from the Hub. Handoff-only accounts have no password."""
    db = get_db()
    # Try by (restaurant_id, hub_user_id)
    u = await db.users.find_one({"restaurant_id": restaurant_id, "hub_user_id": hub_user_id})
    now = datetime.now(timezone.utc).isoformat()
    if u:
        # Update role if changed (Hub is authoritative)
        if u.get("role") != role or not u.get("active", True):
            await db.users.update_one(
                {"id": u["id"]},
                {"$set": {"role": role, "active": True, "updated_at": now}},
            )
            u["role"] = role
            u["active"] = True
        u.pop("_id", None)
        u.pop("password_hash", None)
        return u

    # Create new
    synthetic_email = f"hub-{hub_user_id}@handoff.dacot.app"
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": restaurant_id,
        "hub_user_id": hub_user_id,
        "email": synthetic_email,
        "password_hash": "",  # handoff-only, cannot log in via local /auth/login
        "name": f"Usuário Hub {hub_user_id[:8]}",
        "role": role,
        "active": True,
        "must_change_password": False,
        "created_at": now,
        "updated_at": now,
        "provisioned_by": "hub_handoff",
    }
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        # Race: someone just created it. Re-fetch.
        u = await db.users.find_one({"restaurant_id": restaurant_id, "hub_user_id": hub_user_id})
        if u:
            u.pop("_id", None)
            u.pop("password_hash", None)
            return u
        raise
    doc.pop("password_hash", None)
    return doc


@router.post("/exchange", response_model=ExchangeResponse)
async def exchange(payload: ExchangeInput):
    handoff_claims = _decode_handoff(payload.handoff)

    # anti-replay AFTER validating signature/claims (avoids poisoning jti store with junk)
    await _consume_jti(handoff_claims["jti"], int(handoff_claims["exp"]))

    restaurant_id = str(handoff_claims["restaurant_id"]).strip()
    role = str(handoff_claims["role"])
    hub_user_id = str(handoff_claims["sub"]).split(":", 1)[1]

    # Check module active on the Hub (source of truth). Only after JWT is fully validated.
    await _check_module_active(restaurant_id)

    # Auto-provision (idempotent)
    await _find_or_create_restaurant(restaurant_id)
    user = await _find_or_create_user(restaurant_id, hub_user_id, role)

    # Issue local session (respects existing security helper; expiry passed as arg to avoid env races)
    session_minutes = int(float(os.environ.get("SESSION_HOURS", "8")) * 60)
    token = create_access_token(
        user_id=user["id"],
        restaurant_id=user["restaurant_id"],
        role=user["role"],
        email=user["email"],
        expire_minutes=session_minutes,
    )

    user_out = ExchangeUser(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        role=user["role"],
        restaurant_id=user["restaurant_id"],
        restaurant_slug=str(handoff_claims.get("restaurant_slug", "")).strip() or None,
        must_change_password=bool(user.get("must_change_password", False)),
        active=bool(user.get("active", True)),
    )
    response = ExchangeResponse(
        ok=True,
        token=token,
        session_token=token,
        user=user_out,
    )
    return response


@compat_router.post("/exchange", response_model=dict)
async def exchange_compat(payload: ExchangeInput):
    result = await exchange(payload)
    if isinstance(result, dict):
        return result
    return {
        "ok": True,
        "session_token": result.token,
        "token": result.token,
        "user": result.user.model_dump(),
    }
