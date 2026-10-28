"""Idempotent, authenticated provisioning from DACOT Hub."""
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field
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


def _authorize(provided: str) -> None:
    expected = module_api_key()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(401, "Chave de módulo inválida")


@router.post("/provision")
async def provision(payload: ProvisionInput, x_module_key: str = Header(default="")):
    _authorize(x_module_key)
    if not all(c in "0123456789abcdefABCDEF" for c in payload.tenant_id):
        raise HTTPException(400, "tenant_id inválido")

    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    restaurant = await db.restaurants.find_one({"id": payload.tenant_id})
    conflicting_restaurant = await db.restaurants.find_one({"hub_tenant_id": payload.tenant_id})
    if conflicting_restaurant and conflicting_restaurant.get("id") != payload.tenant_id:
        raise HTTPException(409, "Tenant já está vinculado a outro restaurante")
    if restaurant and restaurant.get("hub_tenant_id") not in (None, payload.tenant_id):
        raise HTTPException(409, "Restaurante já está vinculado a outro tenant")
    if restaurant:
        update = {"hub_tenant_id": payload.tenant_id, "updated_at": now}
        if restaurant.get("provisioned_by") in {"hub", "hub_handoff"}:
            update["name"] = payload.tenant_name.strip()
        await db.restaurants.update_one({"id": payload.tenant_id}, {"$set": update})
    else:
        try:
            await db.restaurants.insert_one({
                "id": payload.tenant_id, "hub_tenant_id": payload.tenant_id,
                "name": payload.tenant_name.strip(), "provisioned_by": "hub",
                "created_at": now, "updated_at": now,
            })
        except DuplicateKeyError:
            raise HTTPException(409, "Conflito ao vincular restaurante")

    user = await db.users.find_one({"hub_user_id": payload.hub_user_id})
    email = str(payload.email).lower().strip()
    email_owner = await db.users.find_one({"email": email})
    if user and user.get("restaurant_id") != payload.tenant_id:
        raise HTTPException(409, "Usuário Hub já pertence a outro restaurante")
    if email_owner and (not user or email_owner.get("id") != user.get("id")):
        raise HTTPException(409, "E-mail já pertence a outro usuário")

    preset = permissions_for_role(payload.role)
    if user:
        await db.users.update_one(
            {"id": user["id"], "restaurant_id": payload.tenant_id},
            {"$set": {
                "email": email, "name": payload.name.strip(), "role": payload.role,
                "permissions": preset, "active": True, "provisioned_by": "hub",
                "updated_at": now,
            }, "$unset": {"custom_role_id": ""}},
        )
        user_id = user["id"]
        created = False
    else:
        user_id = str(uuid.uuid4())
        try:
            await db.users.insert_one({
                "id": user_id, "restaurant_id": payload.tenant_id,
                "hub_user_id": payload.hub_user_id, "email": email,
                "name": payload.name.strip(), "role": payload.role,
                "permissions": preset, "active": True,
                "password_hash": "", "must_change_password": True,
                "provisioned_by": "hub", "created_at": now, "updated_at": now,
            })
        except DuplicateKeyError:
            raise HTTPException(409, "Conflito ao provisionar usuário")
        created = True
    stored = await db.users.find_one({"id": user_id, "restaurant_id": payload.tenant_id})
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
            {"user_id": user_id, "restaurant_id": payload.tenant_id, "used": False},
            {"$set": {"used": True, "invalidated_at": datetime.now(timezone.utc)}},
        )
        await db.first_access_tokens.insert_one({
            "token_hash": token_hash, "user_id": user_id,
            "restaurant_id": payload.tenant_id, "used": False,
            "created_at": datetime.now(timezone.utc), "expires_at": expires_at,
        })
        invite_token = raw
        invite_expires_at = expires_at.isoformat()
    return {
        "ok": True, "created": created, "restaurant_id": payload.tenant_id,
        "user_id": user_id, "invite_token": invite_token,
        "invite_expires_at": invite_expires_at,
    }
