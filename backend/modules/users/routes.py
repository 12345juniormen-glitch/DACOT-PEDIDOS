"""Users management (admin-only). Multi-tenant scoped."""
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator

from core.db import get_db
from core.deps import Tenant, require_permissions
from core.permissions import (
    PERMISSION_GROUPS,
    ROLE_PERMISSION_PRESETS,
    effective_permissions,
    has_permission,
    validate_permissions,
)
from core.security import hash_password


UserRole = Literal["admin", "manager", "waiter", "kitchen"]


class UserCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    temp_password: str = Field(min_length=6, max_length=128)
    role: UserRole
    permissions: list[str] | None = None
    require_password_change: bool = False

    @field_validator("permissions")
    @classmethod
    def permissions_are_known(cls, value):
        if value is None:
            return value
        try:
            return validate_permissions(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class UserUpdateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: UserRole
    active: bool = True
    permissions: list[str] | None = None

    @field_validator("permissions")
    @classmethod
    def permissions_are_known(cls, value):
        if value is None:
            return value
        try:
            return validate_permissions(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class ResetPasswordInput(BaseModel):
    new_temp_password: str = Field(min_length=6, max_length=128)
    require_password_change: bool = False


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: UserRole
    permissions: list[str]
    active: bool
    must_change_password: bool
    created_at: str


def _to_out(doc: dict) -> UserOut:
    return UserOut(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        role=doc.get("role", "waiter"),
        permissions=effective_permissions(doc),
        active=doc.get("active", True),
        must_change_password=bool(doc.get("must_change_password", False)),
        created_at=doc["created_at"],
    )


router = APIRouter(prefix="/users", tags=["users"])


async def _count_active_user_managers(db, restaurant_id: str, exclude_user_id: str | None = None) -> int:
    fallback_roles = [
        role for role, permissions in ROLE_PERMISSION_PRESETS.items()
        if "users.manage" in permissions
    ]
    q = {
        "restaurant_id": restaurant_id,
        "active": True,
        "$or": [
            {"permissions": "users.manage"},
            {"permissions": None, "role": {"$in": fallback_roles}},
        ],
    }
    if exclude_user_id:
        q["id"] = {"$ne": exclude_user_id}
    return await db.users.count_documents(q)


@router.get("/permissions")
async def permission_catalog(tenant: Tenant = Depends(require_permissions("users.view"))):
    return {
        "groups": PERMISSION_GROUPS,
        "presets": {role: sorted(permissions) for role, permissions in ROLE_PERMISSION_PRESETS.items()},
    }


@router.get("", response_model=list[UserOut])
async def list_users(tenant: Tenant = Depends(require_permissions("users.view"))):
    db = get_db()
    docs = await db.users.find(
        {"restaurant_id": tenant.restaurant_id}, {"_id": 0, "password_hash": 0}
    ).sort("name", 1).to_list(1000)
    return [_to_out(d) for d in docs]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreateInput, tenant: Tenant = Depends(require_permissions("users.manage"))):
    db = get_db()
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email já cadastrado")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "email": email,
        "password_hash": hash_password(payload.temp_password),
        "name": payload.name.strip(),
        "role": payload.role,
        "permissions": validate_permissions(payload.permissions) if payload.permissions is not None else None,
        "active": True,
        "must_change_password": payload.require_password_change,
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(doc)
    return _to_out(doc)


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserUpdateInput,
    tenant: Tenant = Depends(require_permissions("users.manage")),
):
    db = get_db()
    existing = await db.users.find_one(
        {"id": user_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    new_permissions = validate_permissions(payload.permissions) if payload.permissions is not None else None
    losing_user_management = has_permission(existing, "users.manage") and (
        not payload.active or "users.manage" not in (
            new_permissions if new_permissions is not None else ROLE_PERMISSION_PRESETS[payload.role]
        )
    )
    if losing_user_management:
        remaining = await _count_active_user_managers(db, tenant.restaurant_id, exclude_user_id=user_id)
        if remaining == 0:
            raise HTTPException(
                status_code=409,
                detail="Não é possível remover o último usuário ativo que gerencia usuários",
            )

    updates = {
        "name": payload.name.strip(),
        "role": payload.role,
        "permissions": new_permissions,
        "active": payload.active,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = await db.users.find_one_and_update(
        {"id": user_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0, "password_hash": 0},
    )
    return _to_out(updated)


@router.post("/{user_id}/reset-password", response_model=UserOut)
async def reset_password(
    user_id: str,
    payload: ResetPasswordInput,
    tenant: Tenant = Depends(require_permissions("users.manage")),
):
    db = get_db()
    updates = {
        "password_hash": hash_password(payload.new_temp_password),
        "must_change_password": payload.require_password_change,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = await db.users.find_one_and_update(
        {"id": user_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0, "password_hash": 0},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    return _to_out(updated)
