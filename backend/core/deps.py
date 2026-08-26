"""FastAPI dependencies for auth + tenant isolation."""
from fastapi import Depends, HTTPException, Request, status
import jwt

from core.db import get_db
from core.security import decode_token


async def get_current_user(request: Request) -> dict:
    """Extract Bearer token from Authorization header, decode JWT, load user."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado")
    token = auth[7:].strip()
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessão expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Tipo de token inválido")

    db = get_db()
    user = await db.users.find_one({"id": payload["sub"]}, {"password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")
    user.pop("_id", None)
    return user


class Tenant:
    """Represents the current tenant + user context."""

    def __init__(self, user: dict):
        self.user = user
        self.restaurant_id: str = user["restaurant_id"]
        self.user_id: str = user["id"]
        self.role: str = user.get("role", "admin")


async def get_tenant(user: dict = Depends(get_current_user)) -> Tenant:
    if "restaurant_id" not in user:
        raise HTTPException(status_code=403, detail="Usuário sem restaurante vinculado")
    return Tenant(user)
