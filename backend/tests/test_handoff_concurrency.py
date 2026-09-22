"""Concurrent handoff provisioning against the disposable local integration server."""

import concurrent.futures
import os
import threading
import time
import uuid

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


def _handoff(restaurant_id, hub_user_id):
    now = int(time.time())
    return jwt.encode({
        "sub": f"tenant_user:{hub_user_id}",
        "restaurant_id": restaurant_id,
        "role": "admin",
        "module": "orders",
        "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"],
        "iat": now,
        "nbf": now - 5,
        "exp": now + 60,
        "jti": uuid.uuid4().hex,
        "handoff_version": 1,
    }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")


def _parallel_exchange(tokens):
    barrier = threading.Barrier(len(tokens))

    def send(token):
        barrier.wait(timeout=10)
        return requests.post(f"{API}/session/exchange", json={"handoff": token}, timeout=20)

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(tokens)) as pool:
        return list(pool.map(send, tokens))


def test_concurrent_first_handoffs_create_one_restaurant():
    tenant_id = f"tenant-handoff-race-{uuid.uuid4().hex}"
    tokens = [_handoff(tenant_id, uuid.uuid4().hex) for _ in range(12)]
    responses = _parallel_exchange(tokens)
    assert [r.status_code for r in responses] == [200] * len(tokens)
    assert all(r.json()["user"]["restaurant_id"] == tenant_id for r in responses)
    with MongoClient(os.environ["MONGO_URL"]) as client:
        db = client[os.environ["DB_NAME"]]
        assert db.restaurants.count_documents({"id": tenant_id}) == 1
        assert db.users.count_documents({"restaurant_id": tenant_id, "hub_user_id": {"$exists": True}}) == len(tokens)


def test_concurrent_handoffs_for_one_user_create_one_user():
    tenant_id = f"tenant-handoff-user-race-{uuid.uuid4().hex}"
    hub_user_id = uuid.uuid4().hex
    tokens = [_handoff(tenant_id, hub_user_id) for _ in range(12)]
    responses = _parallel_exchange(tokens)
    assert [r.status_code for r in responses] == [200] * len(tokens)
    user_ids = {r.json()["user"]["id"] for r in responses}
    assert len(user_ids) == 1
    with MongoClient(os.environ["MONGO_URL"]) as client:
        db = client[os.environ["DB_NAME"]]
        assert db.restaurants.count_documents({"id": tenant_id}) == 1
        assert db.users.count_documents({"restaurant_id": tenant_id, "hub_user_id": hub_user_id}) == 1
