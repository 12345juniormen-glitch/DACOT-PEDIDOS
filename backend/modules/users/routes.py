"""Users management (admin-only). Multi-tenant scoped."""
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core.db import get_db
from core.deps import Tenant, require_roles
from core.security import hash_password


UserRole = Literal["admin", "manager", "waiter", "kitchen"]


class UserCreateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    temp_password: str = Field(min_length=6, max_length=128)
    role: UserRole


class UserUpdateInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: UserRole
    active: bool = True


class ResetPasswordInput(BaseModel):
    new_temp_password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: UserRole
    active: bool
    must_change_password: bool
    created_at: str


def _to_out(doc: dict) -> UserOut:
    return UserOut(
        id=doc["id"],
        name=doc["name"],
        email=doc["email"],
        role=doc.get("role", "waiter"),
        active=doc.get("active", True),
        must_change_password=bool(doc.get("must_change_password", False)),
        created_at=doc["created_at"],
    )


router = APIRouter(prefix="/users", tags=["users"])


async def _count_active_admins(db, restaurant_id: str, exclude_user_id: str | None = None) -> int:
    q = {"restaurant_id": restaurant_id, "role": "admin", "active": True}
    if exclude_user_id:
        q["id"] = {"$ne": exclude_user_id}
    return await db.users.count_documents(q)


@router.get("", response_model=list[UserOut])
async def list_users(tenant: Tenant = Depends(require_roles("admin"))):
    db = get_db()
    docs = await db.users.find(
        {"restaurant_id": tenant.restaurant_id}, {"_id": 0, "password_hash": 0}
    ).sort("name", 1).to_list(1000)
    return [_to_out(d) for d in docs]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreateInput, tenant: Tenant = Depends(require_roles("admin"))):
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
        "active": True,
        "must_change_password": True,
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(doc)
    return _to_out(doc)


@router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    payload: UserUpdateInput,
    tenant: Tenant = Depends(require_roles("admin")),
):
    db = get_db()
    existing = await db.users.find_one(
        {"id": user_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0}
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Prevent losing the last active admin
    demoting = existing.get("role") == "admin" and (payload.role != "admin" or not payload.active)
    if demoting:
        remaining = await _count_active_admins(db, tenant.restaurant_id, exclude_user_id=user_id)
        if remaining == 0:
            raise HTTPException(
                status_code=409,
                detail="Não é possível rebaixar/desativar o último administrador ativo",
            )

    updates = {
        "name": payload.name.strip(),
        "role": payload.role,
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
    tenant: Tenant = Depends(require_roles("admin")),
):
    db = get_db()
    updates = {
        "password_hash": hash_password(payload.new_temp_password),
        "must_change_password": True,
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
