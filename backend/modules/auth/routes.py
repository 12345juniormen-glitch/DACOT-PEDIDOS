"""Auth models & routes: login, /me. Registration is admin-only (out of scope for MVP)."""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from core.db import get_db
from core.deps import get_current_user
from core.security import create_access_token, hash_password, verify_password


UserRole = Literal["admin", "manager", "waiter", "kitchen"]


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ChangePasswordInput(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: UserRole
    restaurant_id: str
    must_change_password: bool = False
    active: bool = True
    created_at: Optional[datetime] = None


class LoginResponse(BaseModel):
    token: str
    user: UserPublic


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginInput):
    db = get_db()
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email ou senha inválidos")

    token = create_access_token(
        user_id=user["id"],
        restaurant_id=user["restaurant_id"],
        role=user.get("role", "admin"),
        email=user["email"],
    )
    user.pop("_id", None)
    user.pop("password_hash", None)
    user.setdefault("active", True)
    user.setdefault("must_change_password", False)
    return LoginResponse(token=token, user=UserPublic(**user))


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    user.setdefault("active", True)
    user.setdefault("must_change_password", False)
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
