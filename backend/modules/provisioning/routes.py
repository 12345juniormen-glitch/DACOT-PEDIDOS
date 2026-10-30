"""Idempotent, authenticated provisioning from DACOT Hub."""
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import get_db
from core.hub_access import module_api_key
from core.permissions import permissions_for_role


router = APIRouter(prefix="/internal/hub", tags=["internal provisioning"])


class ProvisionInput(BaseModel):
    tenant_id: str = Field(min_length=24, max_length=24)
    tenant_name: str = Field(min_length=1, max_length=160)
    hub_user_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    role: Literal["admin", "manager", "waiter", "kitchen"]


class CustomRoleAssignmentInput(BaseModel):
    tenant_id: str = Field(min_length=24, max_length=24)
    custom_role_id: str | None = Field(default=None, min_length=1, max_length=64)


def _authorize(provided: str) -> None:
    expected = module_api_key()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(401, "Chave de módulo inválida")


def _tenant_id(value: str) -> str:
    if len(value) != 24 or not all(char in "0123456789abcdefABCDEF" for char in value):
        raise HTTPException(400, "tenant_id inválido")
    return value.lower()


async def _hub_restaurant(db, tenant_id: str) -> dict:
    restaurant = await db.restaurants.find_one({"id": tenant_id, "hub_tenant_id": tenant_id})
    if not restaurant:
        raise HTTPException(404, "Restaurante Hub não encontrado")
    return restaurant


async def _custom_role(db, tenant_id: str, custom_role_id: str | None) -> dict | None:
    if custom_role_id is None:
        return None
    role = await db.custom_roles.find_one(
        {"id": custom_role_id, "restaurant_id": tenant_id}, {"_id": 0}
    )
    if not role:
        raise HTTPException(404, "Cargo personalizado não encontrado")
    return role


def _custom_role_out(role: dict | None) -> dict | None:
    return None if role is None else {"id": role["id"], "name": role["name"]}


@router.post("/provision")
async def provision(payload: ProvisionInput, x_module_key: str = Header(default="")):
    _authorize(x_module_key)
    tenant_id = _tenant_id(payload.tenant_id)

    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    restaurant = await db.restaurants.find_one({"id": tenant_id})
    conflicting_restaurant = await db.restaurants.find_one({"hub_tenant_id": tenant_id})
    if conflicting_restaurant and conflicting_restaurant.get("id") != tenant_id:
        raise HTTPException(409, "Tenant já está vinculado a outro restaurante")
    if restaurant and restaurant.get("hub_tenant_id") not in (None, tenant_id):
        raise HTTPException(409, "Restaurante já está vinculado a outro tenant")
    if restaurant:
        update = {"hub_tenant_id": tenant_id, "updated_at": now}
        if restaurant.get("provisioned_by") in {"hub", "hub_handoff"}:
            update["name"] = payload.tenant_name.strip()
        await db.restaurants.update_one({"id": tenant_id}, {"$set": update})
    else:
        try:
            await db.restaurants.insert_one({
                "id": tenant_id, "hub_tenant_id": tenant_id,
                "name": payload.tenant_name.strip(), "provisioned_by": "hub",
                "created_at": now, "updated_at": now,
            })
        except DuplicateKeyError:
            raise HTTPException(409, "Conflito ao vincular restaurante")

    user = await db.users.find_one({"hub_user_id": payload.hub_user_id})
    email = str(payload.email).lower().strip()
    email_owner = await db.users.find_one({"email": email})
    if user and user.get("restaurant_id") != tenant_id:
        raise HTTPException(409, "Usuário Hub já pertence a outro restaurante")
    if email_owner and (not user or email_owner.get("id") != user.get("id")):
        raise HTTPException(409, "E-mail já pertence a outro usuário")

    preset = permissions_for_role(payload.role)
    if user:
        custom_role = await _custom_role(
            db,
            tenant_id,
            user.get("custom_role_id") if payload.role == "waiter" else None,
        )
        await db.users.update_one(
            {"id": user["id"], "restaurant_id": tenant_id},
            {"$set": {
                "email": email, "name": payload.name.strip(), "role": payload.role,
                "permissions": list(custom_role["permissions"]) if custom_role else preset,
                "active": True, "provisioned_by": "hub",
                "updated_at": now,
                **({"custom_role_id": custom_role["id"]} if custom_role else {}),
            }, **({} if custom_role else {"$unset": {"custom_role_id": ""}})},
        )
        user_id = user["id"]
        created = False
    else:
        user_id = str(uuid.uuid4())
        try:
            await db.users.insert_one({
                "id": user_id, "restaurant_id": tenant_id,
                "hub_user_id": payload.hub_user_id, "email": email,
                "name": payload.name.strip(), "role": payload.role,
                "permissions": preset, "active": True,
                "password_hash": "", "must_change_password": True,
                "provisioned_by": "hub", "created_at": now, "updated_at": now,
            })
        except DuplicateKeyError:
            raise HTTPException(409, "Conflito ao provisionar usuário")
        created = True
    stored = await db.users.find_one({"id": user_id, "restaurant_id": tenant_id})
    invite_token = None
    invite_expires_at = None
    if not stored.get("password_hash"):
        hours = int(os.environ.get("FIRST_ACCESS_TOKEN_HOURS", "24"))
        if not 1 <= hours <= 168:
            raise HTTPException(503, "Validade do convite não configurada")
        raw = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw.encode()).hexdigest()
        expires_at = datetime.now(timezone.utc) + timedelta(hours=hours)
        await db.first_access_tokens.update_many(
            {"user_id": user_id, "restaurant_id": tenant_id, "used": False},
            {"$set": {"used": True, "invalidated_at": datetime.now(timezone.utc)}},
        )
        await db.first_access_tokens.insert_one({
            "token_hash": token_hash, "user_id": user_id,
            "restaurant_id": tenant_id, "used": False,
            "created_at": datetime.now(timezone.utc), "expires_at": expires_at,
        })
        invite_token = raw
        invite_expires_at = expires_at.isoformat()
    return {
        "ok": True, "created": created, "restaurant_id": tenant_id,
        "user_id": user_id, "invite_token": invite_token,
        "invite_expires_at": invite_expires_at,
    }


@router.get("/custom-roles/v1")
async def list_hub_custom_roles(
    tenant_id: str = Query(min_length=24, max_length=24),
    x_module_key: str = Header(default=""),
):
    """List only public Pedidos-owned role labels for one HUB tenant."""
    _authorize(x_module_key)
    tenant_id = _tenant_id(tenant_id)
    db = get_db()
    await _hub_restaurant(db, tenant_id)
    roles = await db.custom_roles.find(
        {"restaurant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1}
    ).sort("name", 1).to_list(500)
    return {"custom_roles": [_custom_role_out(role) for role in roles]}


@router.get("/users/{hub_user_id}/custom-role/v1")
async def get_hub_user_custom_role(
    hub_user_id: str,
    tenant_id: str = Query(min_length=24, max_length=24),
    x_module_key: str = Header(default=""),
):
    _authorize(x_module_key)
    tenant_id = _tenant_id(tenant_id)
    if not hub_user_id or len(hub_user_id) > 128:
        raise HTTPException(400, "hub_user_id inválido")
    db = get_db()
    await _hub_restaurant(db, tenant_id)
    user = await db.users.find_one({
        "restaurant_id": tenant_id,
        "hub_user_id": hub_user_id,
        "active": True,
    })
    if not user:
        raise HTTPException(404, "Usuário Hub não encontrado")
    role = await _custom_role(db, tenant_id, user.get("custom_role_id"))
    return {"custom_role": _custom_role_out(role)}


@router.put("/users/{hub_user_id}/custom-role/v1")
async def set_hub_user_custom_role(
    hub_user_id: str,
    payload: CustomRoleAssignmentInput,
    x_module_key: str = Header(default=""),
):
    """Set or remove one Pedidos-owned role for a HUB identity.

    The authenticated HUB service derives the administrative tenant and actor
    before this internal call.  This route accepts no browser credential and
    never returns the role permission definition.
    """
    _authorize(x_module_key)
    tenant_id = _tenant_id(payload.tenant_id)
    if not hub_user_id or len(hub_user_id) > 128:
        raise HTTPException(400, "hub_user_id inválido")
    db = get_db()
    await _hub_restaurant(db, tenant_id)
    user = await db.users.find_one({
        "restaurant_id": tenant_id,
        "hub_user_id": hub_user_id,
        "active": True,
    })
    if not user:
        raise HTTPException(404, "Usuário Hub não encontrado")
    if payload.custom_role_id is not None and user.get("role") != "waiter":
        raise HTTPException(409, "Cargo personalizado requer papel básico waiter")
    role = await _custom_role(db, tenant_id, payload.custom_role_id)
    updates = {
        "permissions": list(role["permissions"]) if role else permissions_for_role(user.get("role", "waiter")),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if role:
        updates["custom_role_id"] = role["id"]
    updated = await db.users.find_one_and_update(
        {"id": user["id"], "restaurant_id": tenant_id, "hub_user_id": hub_user_id, "active": True},
        {"$set": updates, **({} if role else {"$unset": {"custom_role_id": ""}})},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "custom_role_id": 1},
    )
    # The active check is repeated in the atomic write so a concurrent
    # deactivation cannot receive a successful administrative response.
    if not updated:
        raise HTTPException(404, "Usuário Hub não encontrado")
    return {"custom_role": _custom_role_out(role)}
