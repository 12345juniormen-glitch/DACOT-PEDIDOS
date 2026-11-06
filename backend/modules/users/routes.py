"""Users management (admin-only). Multi-tenant scoped."""
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator
from pymongo.errors import DuplicateKeyError

from core.db import get_db
from core.deps import Tenant, require_permissions
from core.permissions import (
    ALL_PERMISSIONS,
    PERMISSION_GROUPS,
    ROLE_PERMISSION_PRESETS,
    effective_permissions,
    validate_permissions,
)
from core.security import hash_password
from core.user_manager_guard import (
    finish_user_manager_change,
    is_active_user_manager,
    prepare_user_manager_change,
    register_user_manager,
)


UserRole = Literal["admin", "manager", "waiter", "kitchen"]


class UserCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    temp_password: str = Field(min_length=6, max_length=128)
    role: UserRole
    custom_role_id: str | None = Field(default=None, max_length=64)
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
    custom_role_id: str | None = Field(default=None, max_length=64)
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
    custom_role_id: str | None = None
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
        custom_role_id=doc.get("custom_role_id"),
        permissions=effective_permissions(doc),
        active=doc.get("active", True),
        must_change_password=bool(doc.get("must_change_password", False)),
        created_at=doc["created_at"],
    )


router = APIRouter(prefix="/users", tags=["users"])


class CustomRoleInput(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    permissions: list[str]

    @field_validator("name")
    @classmethod
    def normalized_name(cls, value):
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Informe o nome do cargo")
        return normalized

    @field_validator("permissions")
    @classmethod
    def permissions_are_known(cls, value):
        try:
            return validate_permissions(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


class CustomRoleOut(BaseModel):
    id: str
    name: str
    permissions: list[str]
    created_at: str
    updated_at: str


def _custom_role_out(doc: dict) -> CustomRoleOut:
    return CustomRoleOut(
        id=doc["id"],
        name=doc["name"],
        permissions=validate_permissions(doc.get("permissions", [])),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


async def _find_custom_role(db, restaurant_id: str, custom_role_id: str | None) -> dict | None:
    if not custom_role_id:
        return None
    role = await db.custom_roles.find_one(
        {"id": custom_role_id, "restaurant_id": restaurant_id}, {"_id": 0}
    )
    if not role:
        raise HTTPException(status_code=404, detail="Cargo personalizado não encontrado")
    return role


def _permissions_to_grant(tenant: Tenant, permissions: list[str], role: str, custom_role: dict | None) -> None:
    requested = set(permissions)
    if not requested.issubset(tenant.permissions):
        raise HTTPException(status_code=403, detail="Você não pode conceder permissões que não possui")
    if role == "admin" and custom_role is None and not ALL_PERMISSIONS.issubset(tenant.permissions):
        raise HTTPException(status_code=403, detail="Somente um administrador com autoridade equivalente pode atribuir o cargo Administrador")


def _resolved_permissions(role: str, custom_role: dict | None, explicit: list[str] | None) -> list[str]:
    if explicit is not None:
        return validate_permissions(explicit)
    if custom_role is not None:
        return validate_permissions(custom_role.get("permissions", []))
    return sorted(ROLE_PERMISSION_PRESETS[role])


@router.get("/permissions")
async def permission_catalog(tenant: Tenant = Depends(require_permissions("users.view"))):
    return {
        "groups": PERMISSION_GROUPS,
        "presets": {role: sorted(permissions) for role, permissions in ROLE_PERMISSION_PRESETS.items()},
    }


@router.get("/custom-roles", response_model=list[CustomRoleOut])
async def list_custom_roles(tenant: Tenant = Depends(require_permissions("users.view"))):
    docs = await get_db().custom_roles.find(
        {"restaurant_id": tenant.restaurant_id}, {"_id": 0, "restaurant_id": 0, "name_key": 0}
    ).sort("name", 1).to_list(500)
    return [_custom_role_out(doc) for doc in docs]


@router.post("/custom-roles", response_model=CustomRoleOut, status_code=201)
async def create_custom_role(
    payload: CustomRoleInput,
    tenant: Tenant = Depends(require_permissions("users.manage")),
):
    permissions = validate_permissions(payload.permissions)
    _permissions_to_grant(tenant, permissions, "waiter", None)
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "name": payload.name,
        "name_key": payload.name.casefold(),
        "permissions": permissions,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await get_db().custom_roles.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Já existe um cargo com este nome")
    return _custom_role_out(doc)


@router.put("/custom-roles/{custom_role_id}", response_model=CustomRoleOut)
async def update_custom_role(
    custom_role_id: str,
    payload: CustomRoleInput,
    tenant: Tenant = Depends(require_permissions("users.manage")),
):
    permissions = validate_permissions(payload.permissions)
    _permissions_to_grant(tenant, permissions, "waiter", None)
    updates = {
        "name": payload.name,
        "name_key": payload.name.casefold(),
        "permissions": permissions,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        updated = await get_db().custom_roles.find_one_and_update(
            {"id": custom_role_id, "restaurant_id": tenant.restaurant_id},
            {"$set": updates}, return_document=True, projection={"_id": 0},
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Já existe um cargo com este nome")
    if not updated:
        raise HTTPException(status_code=404, detail="Cargo personalizado não encontrado")
    return _custom_role_out(updated)


@router.delete("/custom-roles/{custom_role_id}", status_code=204)
async def delete_custom_role(
    custom_role_id: str,
    tenant: Tenant = Depends(require_permissions("users.manage")),
):
    db = get_db()
    existing = await _find_custom_role(db, tenant.restaurant_id, custom_role_id)
    in_use = await db.users.count_documents({
        "restaurant_id": tenant.restaurant_id, "custom_role_id": existing["id"],
    })
    if in_use:
        raise HTTPException(status_code=409, detail="Este cargo está vinculado a usuários e não pode ser excluído")
    await db.custom_roles.delete_one({"id": custom_role_id, "restaurant_id": tenant.restaurant_id})


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
    custom_role = await _find_custom_role(db, tenant.restaurant_id, payload.custom_role_id)
    permissions = _resolved_permissions(payload.role, custom_role, payload.permissions)
    _permissions_to_grant(tenant, permissions, payload.role, custom_role)
    stored_permissions = (
        permissions if payload.permissions is not None or custom_role is not None else None
    )
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
        "role": "waiter" if custom_role else payload.role,
        "custom_role_id": custom_role["id"] if custom_role else None,
        "permissions": stored_permissions,
        "active": True,
        "must_change_password": payload.require_password_change,
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(doc)
    if is_active_user_manager(doc):
        await register_user_manager(db, tenant.restaurant_id, doc["id"])
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

    custom_role = await _find_custom_role(db, tenant.restaurant_id, payload.custom_role_id)
    new_role = "waiter" if custom_role else payload.role
    new_permissions = _resolved_permissions(new_role, custom_role, payload.permissions)
    _permissions_to_grant(tenant, new_permissions, new_role, custom_role)
    stored_permissions = (
        new_permissions if payload.permissions is not None or custom_role is not None else None
    )

    updates = {
        "name": payload.name.strip(),
        "role": new_role,
        "custom_role_id": custom_role["id"] if custom_role else None,
        "permissions": stored_permissions,
        "active": payload.active,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    transition = await prepare_user_manager_change(
        db,
        tenant.restaurant_id,
        user_id,
        existing,
        {**existing, **updates},
    )
    updated = await db.users.find_one_and_update(
        {"id": user_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0, "password_hash": 0},
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    await finish_user_manager_change(db, tenant.restaurant_id, user_id, transition)
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
