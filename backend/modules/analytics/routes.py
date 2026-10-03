"""Internal revenue aggregation for the DACOT Hub.

This router never accepts a restaurant selector from an HTTP client. The
restaurant id is taken solely from a short-lived assertion signed by the Hub.
"""
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import jwt
from fastapi import APIRouter, Header, HTTPException, Response

from core.db import get_db


ANALYTICS_AUDIENCE = "dacot-orders-analytics"
ANALYTICS_SCOPE = "analytics.revenue"
ANALYTICS_MODULE = "orders"
RESTAURANT_TZ = ZoneInfo("America/Sao_Paulo")

router = APIRouter(prefix="/internal/analytics", tags=["internal analytics"])


def _fail(detail: str, status_code: int = 401) -> None:
    raise HTTPException(status_code=status_code, detail=f"Assertion de analytics inválida: {detail}")


def _decode_assertion(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        _fail("ausente")
    token = authorization[7:].strip()
    try:
        claims = jwt.decode(
            token,
            os.environ.get("HANDOFF_JWT_SECRET", ""),
            algorithms=["HS256"],
            issuer=os.environ.get("HANDOFF_ISSUER", ""),
            audience=ANALYTICS_AUDIENCE,
            options={"require": ["iss", "aud", "exp", "nbf", "iat", "jti", "restaurant_id", "module", "scope"]},
        )
    except jwt.ExpiredSignatureError:
        _fail("expirada")
    except jwt.ImmatureSignatureError:
        _fail("nbf não atingido")
    except jwt.InvalidIssuerError:
        _fail("issuer inválido")
    except jwt.InvalidAudienceError:
        _fail("audience inválida")
    except jwt.InvalidSignatureError:
        _fail("assinatura inválida")
    except jwt.InvalidTokenError:
        _fail("malformada")

    restaurant_id = str(claims.get("restaurant_id", ""))
    if len(restaurant_id) != 24 or any(char not in "0123456789abcdefABCDEF" for char in restaurant_id):
        _fail("restaurant_id inválido")
    if claims.get("module") != ANALYTICS_MODULE or claims.get("scope") != ANALYTICS_SCOPE:
        _fail("escopo inválido")
    if not isinstance(claims.get("jti"), str) or not claims["jti"].strip():
        _fail("jti inválido")
    if type(claims.get("iat")) is not int or type(claims.get("exp")) is not int or not 0 < claims["exp"] - claims["iat"] <= 60:
        _fail("validade inválida")
    return restaurant_id


def _period_bounds() -> tuple[str, str, str, str]:
    """Today and current month in the fixed operational restaurant timezone."""
    now = datetime.now(RESTAURANT_TZ)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    next_day = today_start + timedelta(days=1)
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1)
    return tuple(value.astimezone(timezone.utc).isoformat() for value in (today_start, next_day, month_start, next_month))


@router.get("/revenue")
async def revenue(response: Response, authorization: str | None = Header(default=None)):
    restaurant_id = _decode_assertion(authorization)
    today_start, today_end, month_start, month_end = _period_bounds()
    pipeline = [
        {"$match": {
            "restaurant_id": restaurant_id,
            "status": "delivered",
            "delivered_at": {"$gte": month_start, "$lt": month_end},
        }},
        {"$facet": {
            "today": [
                {"$match": {"delivered_at": {"$gte": today_start, "$lt": today_end}}},
                {"$group": {"_id": None, "total_cents": {"$sum": "$total_cents"}}},
            ],
            "current_month": [
                {"$group": {"_id": None, "total_cents": {"$sum": "$total_cents"}}},
            ],
        }},
    ]
    rows = await get_db().orders.aggregate(pipeline).to_list(1)
    aggregates = rows[0] if rows else {"today": [], "current_month": []}
    today = int(aggregates["today"][0]["total_cents"]) if aggregates["today"] else 0
    current_month = int(aggregates["current_month"][0]["total_cents"]) if aggregates["current_month"] else 0
    response.headers["Cache-Control"] = "no-store"
    return {
        "today_cents": today,
        "current_month_cents": current_month,
        "currency": "BRL",
        "timezone": str(RESTAURANT_TZ),
    }
