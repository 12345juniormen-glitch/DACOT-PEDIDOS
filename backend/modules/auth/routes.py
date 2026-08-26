"""Auth models & routes: login, /me. Registration is admin-only (out of scope for MVP)."""
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from core.db import get_db
from core.deps import get_current_user
from core.security import create_access_token, verify_password


UserRole = Literal["admin", "manager", "waiter", "kitchen"]


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str
    role: UserRole
    restaurant_id: str
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
    return LoginResponse(token=token, user=UserPublic(**user))


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return UserPublic(**user)


@router.post("/logout")
async def logout(_user: dict = Depends(get_current_user)):
    # Bearer tokens are stateless; client discards the token.
    return {"ok": True}
