"""Password hashing (bcrypt) + JWT helpers."""
import os
from datetime import datetime, timezone, timedelta
from typing import Any

import bcrypt
import jwt

JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _get_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, restaurant_id: str, role: str, email: str, expire_minutes: int | None = None) -> str:
    if expire_minutes is None:
        expire_minutes = int(os.environ.get("JWT_EXPIRE_MINUTES", "720"))
    payload = {
        "sub": user_id,
        "restaurant_id": restaurant_id,
        "role": role,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=expire_minutes),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
