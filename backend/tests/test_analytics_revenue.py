"""Disposable integration coverage for the aggregate-only Hub analytics API."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import jwt
import pytest
import requests
from pymongo import MongoClient


pytestmark = pytest.mark.skipif(
    os.environ.get("DACOT_LOCAL_INTEGRATION") != "1"
    or not os.environ.get("REACT_APP_BACKEND_URL", "").startswith("http://127.0.0.1:"),
    reason="Only the disposable loopback integration runner may run these tests",
)
API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


def _assertion(restaurant_id, **overrides):
    now = int(time.time())
    claims = {
        "iss": os.environ["HANDOFF_ISSUER"], "aud": "dacot-orders-analytics",
        "restaurant_id": restaurant_id, "module": "orders", "scope": "analytics.revenue",
        "jti": uuid.uuid4().hex, "iat": now, "nbf": now - 1, "exp": now + 30,
        **overrides,
    }
    return jwt.encode(claims, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")


def _order(restaurant_id, cents, delivered_at, status="delivered"):
    return {"id": uuid.uuid4().hex, "restaurant_id": restaurant_id, "total_cents": cents,
            "status": status, "delivered_at": delivered_at, "created_at": delivered_at, "updated_at": delivered_at}


def test_revenue_assertion_is_strict_and_aggregation_is_tenant_scoped():
    restaurant_a, restaurant_b = uuid.uuid4().hex[:24], uuid.uuid4().hex[:24]
    local_now = datetime.now(ZoneInfo("America/Sao_Paulo"))
    today = local_now.replace(hour=12, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    previous_month = (local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0) - timedelta(seconds=1)).astimezone(timezone.utc).isoformat()
    with MongoClient(os.environ["MONGO_URL"]) as client:
        client[os.environ["DB_NAME"]].orders.insert_many([
            _order(restaurant_a, 10_000, today), _order(restaurant_a, 9_999, today, "cancelled"),
            _order(restaurant_a, 8_888, previous_month), _order(restaurant_b, 50_000, today),
        ])
    endpoint = API + "/internal/analytics/revenue"
    result = requests.get(endpoint, headers={"Authorization": f"Bearer {_assertion(restaurant_a)}"}, timeout=20)
    assert result.status_code == 200 and result.headers["Cache-Control"] == "no-store"
    assert result.json() == {"today_cents": 10_000, "current_month_cents": 10_000,
                             "currency": "BRL", "timezone": "America/Sao_Paulo"}
    for token in (_assertion(restaurant_a, aud="dacot-orders"), _assertion(restaurant_a, iss="other"),
                  _assertion(restaurant_a, exp=int(time.time()) - 1), _assertion(""),
                  jwt.encode({"bad": True}, "wrong", algorithm="HS256")):
        assert requests.get(endpoint, headers={"Authorization": f"Bearer {token}"}, timeout=20).status_code == 401
