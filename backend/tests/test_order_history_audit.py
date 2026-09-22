"""Tenant-scoped paged history and atomic, append-only order events."""

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


def session(tenant_id, role="admin"):
    now = int(time.time())
    token = jwt.encode({
        "sub": f"tenant_user:{uuid.uuid4().hex}", "restaurant_id": tenant_id,
        "role": role, "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
        "exp": now + 60, "jti": uuid.uuid4().hex, "handoff_version": 1,
    }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")
    response = requests.post(f"{API}/session/exchange", json={"handoff": token}, timeout=20)
    assert response.status_code == 200, response.text[:200]
    return {"Authorization": f"Bearer {response.json()['token']}"}, response.json()["user"]["id"]


def product(headers, name):
    response = requests.post(f"{API}/products", json={"name": name, "price": 20, "category": "Test"}, headers=headers, timeout=20)
    assert response.status_code == 201, response.text[:200]
    return response.json()["id"]


def order(headers, product_id, customer_id=None):
    payload = {"items": [{"product_id": product_id, "quantity": 1}], "customer_id": customer_id}
    response = requests.post(f"{API}/orders", json=payload, headers=headers, timeout=20)
    assert response.status_code == 201, response.text[:200]
    return response.json()


def history(headers, **params):
    return requests.get(f"{API}/orders/history", params=params, headers=headers, timeout=20)


def events(headers, order_id):
    return requests.get(f"{API}/orders/{order_id}/events", headers=headers, timeout=20)


def status(headers, order_id, target):
    return requests.patch(f"{API}/orders/{order_id}/status", json={"status": target}, headers=headers, timeout=20)


def test_history_pages_are_bounded_stable_and_tenant_scoped():
    tenant = f"history-page-{uuid.uuid4().hex}"
    headers, _ = session(tenant)
    p = product(headers, "Paged product")
    created = [order(headers, p) for _ in range(7)]
    other_headers, _ = session(f"other-{uuid.uuid4().hex}")
    other = order(other_headers, product(other_headers, "Foreign product"))
    pages = [history(headers, page=n, page_size=3) for n in (1, 2, 3)]
    assert all(r.status_code == 200 for r in pages)
    bodies = [r.json() for r in pages]
    assert [len(b["items"]) for b in bodies] == [3, 3, 1]
    assert all(b["total"] == 7 and b["pages"] == 3 for b in bodies)
    ids = [item["id"] for b in bodies for item in b["items"]]
    assert set(ids) == {item["id"] for item in created}
    assert other["id"] not in ids
    assert history(headers, page=4, page_size=3).json()["items"] == []
    assert history(headers, page=0).status_code == 422
    assert history(headers, page_size=51).status_code == 422


def test_history_indexes_match_tenant_and_filter_access_paths():
    with MongoClient(os.environ["MONGO_URL"]) as client:
        indexes = client[os.environ["DB_NAME"]].orders.index_information().values()
        keys = {tuple(index["key"]) for index in indexes}
    assert (("restaurant_id", 1), ("created_at", -1)) in keys
    assert (("restaurant_id", 1), ("status", 1), ("created_at", -1)) in keys
    assert (("restaurant_id", 1), ("customer_id", 1), ("created_at", -1)) in keys
    assert (("restaurant_id", 1), ("items.product_id", 1), ("created_at", -1)) in keys


def test_history_filters_combine_period_status_customer_product_and_search():
    tenant = f"history-filter-{uuid.uuid4().hex}"
    headers, _ = session(tenant)
    p1, p2 = product(headers, "Filter one"), product(headers, "Filter two")
    customer = requests.post(f"{API}/customers", json={"name": "Ana Filtro", "phone": "11987654321"}, headers=headers, timeout=20)
    assert customer.status_code == 201
    customer_id = customer.json()["id"]
    matching = order(headers, p1, customer_id)
    assert status(headers, matching["id"], "in_preparation").status_code == 200
    assert status(headers, matching["id"], "ready").status_code == 200
    assert status(headers, matching["id"], "delivered").status_code == 200
    order(headers, p1, customer_id)
    order(headers, p2, customer_id)
    old = order(headers, p1, customer_id)
    start_local = datetime.now(ZoneInfo("America/Sao_Paulo")).date()
    yesterday = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    with MongoClient(os.environ["MONGO_URL"]) as client:
        client[os.environ["DB_NAME"]].orders.update_one(
            {"id": old["id"], "restaurant_id": tenant}, {"$set": {"created_at": yesterday}},
        )
    params = {
        "created_from": start_local.isoformat(), "created_to": start_local.isoformat(),
        "status": "delivered", "customer_id": customer_id, "product_id": p1,
        "search": f"#{matching['order_number']}", "page_size": 2,
    }
    response = history(headers, **params)
    assert response.status_code == 200, response.text[:200]
    assert response.json()["total"] == 1
    assert [item["id"] for item in response.json()["items"]] == [matching["id"]]
    assert history(headers, **{**params, "search": "Ana Filtro"}).json()["total"] == 1
    assert history(headers, **{**params, "product_id": p2}).json()["total"] == 0
    assert history(headers, created_from="2026-09-18", created_to="2026-09-17").status_code == 422


def test_status_events_record_actor_rollback_and_delivery_without_overwriting():
    tenant = f"history-events-{uuid.uuid4().hex}"
    admin_h, admin_id = session(tenant)
    kitchen_h, kitchen_id = session(tenant, "kitchen")
    created = order(admin_h, product(admin_h, "Audit product"))
    oid = created["id"]
    initial_events = events(admin_h, oid).json()
    assert status(kitchen_h, oid, "new").status_code == 200
    assert status(kitchen_h, oid, "ready").status_code == 409
    assert events(admin_h, oid).json() == initial_events
    for target in ("in_preparation", "ready", "in_preparation", "ready"):
        assert status(kitchen_h, oid, target).status_code == 200
    delivered = status(admin_h, oid, "delivered")
    assert delivered.status_code == 200
    recorded = events(admin_h, oid)
    assert recorded.status_code == 200
    trail = recorded.json()
    assert [e["type"] for e in trail] == ["created"] + ["status_changed"] * 5
    assert [(e["previous_status"], e["new_status"]) for e in trail] == [
        (None, "new"), ("new", "in_preparation"), ("in_preparation", "ready"),
        ("ready", "in_preparation"), ("in_preparation", "ready"), ("ready", "delivered"),
    ]
    assert [e["user_id"] for e in trail] == [admin_id] + [kitchen_id] * 4 + [admin_id]
    assert all(e["restaurant_id"] == tenant and e["order_id"] == oid for e in trail)
    assert len({e["id"] for e in trail}) == len(trail)
    assert trail[0]["occurred_at"] == created["created_at"]
    assert trail[-1]["occurred_at"] == delivered.json()["delivered_at"]
    assert events(kitchen_h, oid).json() == trail
    foreign_h, _ = session(f"foreign-{uuid.uuid4().hex}")
    assert events(foreign_h, oid).status_code == 404


def test_normal_operations_only_append_events_and_old_orders_remain_usable():
    tenant = f"history-legacy-{uuid.uuid4().hex}"
    headers, _ = session(tenant)
    p = product(headers, "Legacy product")
    created = order(headers, p)
    oid = created["id"]
    before = events(headers, oid).json()
    payload = {"items": [{"product_id": p, "quantity": 2}], "events": []}
    edited = requests.put(f"{API}/orders/{oid}", json=payload, headers=headers, timeout=20)
    assert edited.status_code == 200, edited.text[:200]
    after_edit = events(headers, oid).json()
    assert after_edit[:len(before)] == before
    assert after_edit[-1]["type"] == "updated"
    assert after_edit[-1]["previous_status"] == after_edit[-1]["new_status"] == "new"
    assert status(headers, oid, "in_preparation").status_code == 200
    assert events(headers, oid).json()[:len(after_edit)] == after_edit
    duplicated = requests.post(f"{API}/orders/{oid}/duplicate", headers=headers, timeout=20)
    assert duplicated.status_code == 201
    duplicate_events = events(headers, duplicated.json()["id"]).json()
    assert len(duplicate_events) == 1 and duplicate_events[0]["type"] == "created"
    with MongoClient(os.environ["MONGO_URL"]) as client:
        client[os.environ["DB_NAME"]].orders.update_one(
            {"id": oid, "restaurant_id": tenant}, {"$unset": {"events": ""}},
        )
    assert events(headers, oid).json() == []
    assert requests.get(f"{API}/orders/{oid}", headers=headers, timeout=20).status_code == 200
    assert status(headers, oid, "ready").status_code == 200
    legacy_events = events(headers, oid).json()
    assert len(legacy_events) == 1
    assert legacy_events[0]["previous_status"] == "in_preparation"
    assert legacy_events[0]["new_status"] == "ready"
