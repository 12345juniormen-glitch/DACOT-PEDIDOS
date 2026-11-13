import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from modules.orders import inventory_outbox


def test_inventory_snapshot_is_opt_in_and_excludes_customer_and_free_text(monkeypatch):
    tenant = SimpleNamespace(restaurant_id="restaurant-test")
    order = {"id": "order-1", "order_number": 1001, "status": "in_preparation",
        "customer_name": "Cliente", "notes": "informação pessoal",
        "items": [{"product_id": "product-1", "product_name": "Produto",
                   "quantity": 2, "notes": "sem cebola"}]}
    monkeypatch.setenv("INVENTORY_INTEGRATION_ENABLED", "false")
    assert inventory_outbox.make_order_snapshot(tenant, order, 1, "2026-01-01T00:00:00+00:00") is None
    monkeypatch.setenv("INVENTORY_INTEGRATION_ENABLED", "true")
    monkeypatch.setenv("INVENTORY_INTEGRATION_RESTAURANT_IDS", "restaurant-test")
    event = inventory_outbox.make_order_snapshot(tenant, order, 1, "2026-01-01T00:00:00+00:00")
    assert event["source"] == "dacot-pedidos"
    assert event["items"] == [{"product_id": "product-1", "product_name": "Produto", "quantity": 2}]
    assert "customer_name" not in event and "notes" not in event


def test_delivery_uses_hmac_and_versioned_stock_endpoint(monkeypatch):
    secret = "orders-service-test-secret-at-least-32-chars"
    monkeypatch.setenv("INVENTORY_API_URL", "https://inventory.example")
    monkeypatch.setenv("INVENTORY_INTEGRATION_SECRET", secret)
    captured = {}

    class Response:
        status_code = 200
        text = "ok"

    class Client:
        async def post(self, url, *, content, headers):
            captured.update(url=url, content=content, headers=headers)
            return Response()

    event = {"event_id": "event-1", "event_type": "order.snapshot", "event_version": 1}
    code, detail = asyncio.run(inventory_outbox._deliver(Client(), {"event": event}))
    assert (code, detail) == (200, "ok")
    assert captured["url"] == "https://inventory.example/api/v1/integrations/orders/events"
    timestamp = captured["headers"]["X-DACOT-Timestamp"]
    message = (b"POST\n/api/v1/integrations/orders/events\n" + timestamp.encode()
               + b"\n" + captured["content"])
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    assert captured["headers"]["X-DACOT-Signature"] == f"sha256={expected}"
    assert json.loads(captured["content"]) == event


def test_dispatch_preserves_fifo_transitions_and_advances_only_after_success():
    now = datetime.now(timezone.utc)
    order = {"id": "order-1", "restaurant_id": "restaurant-test", "inventory_outbox": [
        inventory_outbox.pending_outbox({"event_id": "prepare", "status": "in_preparation"}),
        inventory_outbox.pending_outbox({"event_id": "cancel", "status": "cancelled"}),
    ]}
    for item in order["inventory_outbox"]:
        item["next_attempt_at"] = now - timedelta(seconds=1)

    class Cursor:
        def sort(self, *_args):
            return self

        def limit(self, _count):
            return self

        async def to_list(self, _count):
            head = order["inventory_outbox"][0] if order["inventory_outbox"] else None
            if head and head["state"] in {"pending", "retry"} and head["next_attempt_at"] <= now:
                return [{"id": order["id"], "restaurant_id": order["restaurant_id"],
                         "inventory_outbox": [dict(head)]}]
            return []

    class Orders:
        def find(self, *_args):
            return Cursor()

        async def find_one_and_update(self, selector, update, **_kwargs):
            head = order["inventory_outbox"][0]
            if selector["inventory_outbox.0.event.event_id"] != head["event"]["event_id"]:
                return None
            head["lease_until"] = update["$set"]["inventory_outbox.0.lease_until"]
            return {"inventory_outbox": [dict(head)]}

        async def update_one(self, selector, update):
            head = order["inventory_outbox"][0]
            if selector["inventory_outbox.0.event.event_id"] != head["event"]["event_id"]:
                return
            if "$pull" in update:
                order["inventory_outbox"].pop(0)

    sent = []

    class Client:
        async def post(self, _url, *, content, headers):
            sent.append(json.loads(content)["event_id"])
            return SimpleNamespace(status_code=200, text="ok")

    class DB:
        orders = Orders()

    async def deliver_one():
        return await inventory_outbox.dispatch_once(DB(), Client())

    assert asyncio.run(deliver_one()) == 1
    assert sent == ["prepare"]
    assert order["inventory_outbox"][0]["event"]["event_id"] == "cancel"
    assert asyncio.run(deliver_one()) == 1
    assert sent == ["prepare", "cancel"]
    assert order["inventory_outbox"] == []
