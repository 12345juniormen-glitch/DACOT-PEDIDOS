"""FastAPI dependencies for auth + tenant isolation + RBAC."""
from fastapi import Depends, HTTPException, Request, status
import jwt

from core.db import get_db
from core.security import decode_token


# Paths that a user with must_change_password=True is still allowed to hit.
_PW_LOCK_ALLOWED_PATHS = {
    "/api/auth/me",
    "/api/auth/logout",
    "/api/auth/change-password",
}


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
    if not user.get("active", True):
        raise HTTPException(status_code=401, detail="Usuário inativo")

    # Tenant/role must match the authenticated identity; the client cannot choose a tenant
    # by tampering with JWT claims or by replaying a valid token for a different restaurant.
    if payload.get("restaurant_id") != user.get("restaurant_id"):
        raise HTTPException(status_code=401, detail="Tenant da sessão não corresponde ao usuário autenticado")
    if payload.get("role") != user.get("role"):
        raise HTTPException(status_code=401, detail="Role da sessão não corresponde ao usuário autenticado")

    # If password change is required, only allow a small allow-list of routes.
    if user.get("must_change_password") and request.url.path not in _PW_LOCK_ALLOWED_PATHS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Troca de senha obrigatória",
        )
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


def require_roles(*allowed: str):
    """Dependency factory. Usage: Depends(require_roles('admin','manager'))."""
    allowed_set = set(allowed)

    async def _dep(tenant: Tenant = Depends(get_tenant)) -> Tenant:
        if tenant.role not in allowed_set:
            raise HTTPException(status_code=403, detail="Acesso negado para este papel")
        return tenant

    return _dep
