"""Durable, per-order outbox for the optional DACOT-ESTOQUE integration."""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from pymongo import ReturnDocument

logger = logging.getLogger("dacot.inventory_outbox")
SOURCE = "dacot-pedidos"


def integration_enabled() -> bool:
    return os.getenv("INVENTORY_INTEGRATION_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def integration_tenant_ids() -> set[str]:
    return {tenant.strip() for tenant in os.getenv("INVENTORY_INTEGRATION_RESTAURANT_IDS", "").split(",")
            if tenant.strip()}


def validate_configuration() -> bool:
    if not integration_enabled():
        return False
    base_url = os.getenv("INVENTORY_API_URL", "").strip().rstrip("/")
    secret = os.getenv("INVENTORY_INTEGRATION_SECRET", "")
    if not base_url.startswith("https://") or len(secret) < 32 or not integration_tenant_ids():
        logger.error("Order integration is enabled but HTTPS URL, service key, or restaurant allowlist is missing; pending events are retained")
        return False
    return True


def make_order_snapshot(tenant, order: dict, revision: int, occurred_at: str) -> dict | None:
    if (not integration_enabled()
            or tenant.restaurant_id not in integration_tenant_ids()):
        return None
    return {
        "event_id": uuid.uuid4().hex,
        "event_type": "order.snapshot",
        "event_version": 1,
        "source": SOURCE,
        "restaurant_id": tenant.restaurant_id,
        "order_id": order["id"],
        "order_number": order["order_number"],
        "order_revision": revision,
        "status": order["status"],
        "occurred_at": occurred_at,
        # IDs and quantities only. Customer data and free-text notes never leave Pedidos.
        "items": [{"product_id": item["product_id"], "product_name": item["product_name"],
                   "quantity": item["quantity"]}
                  for item in order["items"]],
    }


async def _deliver(client: httpx.AsyncClient, outbox: dict) -> tuple[int | None, str | None]:
    base_url = os.getenv("INVENTORY_API_URL", "").strip().rstrip("/")
    secret = os.getenv("INVENTORY_INTEGRATION_SECRET", "")
    body = json.dumps(outbox["event"], sort_keys=True, separators=(",", ":")).encode()
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    message = b"POST\n/api/v1/integrations/orders/events\n" + timestamp.encode("ascii") + b"\n" + body
    signature = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    try:
        response = await client.post(
            f"{base_url}/api/v1/integrations/orders/events", content=body,
            headers={"Content-Type": "application/json", "X-DACOT-Source": SOURCE,
                     "X-DACOT-Timestamp": timestamp, "X-DACOT-Signature": f"sha256={signature}"},
        )
        return response.status_code, response.text[:300]
    except httpx.HTTPError as exc:
        return None, type(exc).__name__


async def dispatch_once(db, client: httpx.AsyncClient, *, limit: int = 20) -> int:
    now = datetime.now(timezone.utc)
    # Only the head event may be delivered. This preserves status transitions
    # (especially in_preparation -> cancelled) across retries and worker replicas.
    query = {"inventory_outbox.0.state": {"$in": ["pending", "retry"]},
             "inventory_outbox.0.next_attempt_at": {"$lte": now},
             "$or": [{"inventory_outbox.0.lease_until": {"$exists": False}},
                     {"inventory_outbox.0.lease_until": {"$lte": now}}]}
    orders = await db.orders.find(query, {"_id": 0, "id": 1, "restaurant_id": 1,
        "inventory_outbox": 1}).sort("inventory_outbox.next_attempt_at", 1).limit(limit).to_list(limit)
    delivered = 0
    for order in orders:
        event_id = order["inventory_outbox"][0]["event"]["event_id"]
        lease = now + timedelta(seconds=60)
        claimed = await db.orders.find_one_and_update(
            {"id": order["id"], "restaurant_id": order["restaurant_id"],
             "inventory_outbox.0.event.event_id": event_id,
             "inventory_outbox.0.state": {"$in": ["pending", "retry"]},
             "inventory_outbox.0.next_attempt_at": {"$lte": now},
             "$or": [{"inventory_outbox.0.lease_until": {"$exists": False}},
                     {"inventory_outbox.0.lease_until": {"$lte": now}}]},
            {"$set": {"inventory_outbox.0.lease_until": lease}},
            return_document=ReturnDocument.AFTER,
        )
        if not claimed:
            continue
        entry = claimed["inventory_outbox"][0]
        code, detail = await _deliver(client, entry)
        current = datetime.now(timezone.utc)
        attempts = int(entry.get("attempts", 0)) + 1
        if code is not None and 200 <= code < 300:
            state, next_at = "delivered", current
            delivered += 1
        else:
            # Authentication/validation failures are visible, retained, and retried slowly;
            # temporary failures use bounded exponential backoff.
            state = "retry"
            delay = min(15 * (2 ** min(attempts, 8)), 3600)
            if code is not None and code < 500:
                delay = 3600
            next_at = current + timedelta(seconds=delay)
            logger.warning("Inventory event delivery failed: status=%s event_id=%s", code, event_id)
        selector = {"id": order["id"], "restaurant_id": order["restaurant_id"],
                    "inventory_outbox.0.event.event_id": event_id}
        if state == "delivered":
            # The stock server durably records the idempotent event before returning 2xx.
            # Removing it from the queue advances the FIFO head and bounds order size.
            await db.orders.update_one(selector, {"$pull": {"inventory_outbox": {
                "event.event_id": event_id}}})
        else:
            await db.orders.update_one(selector, {
                "$set": {"inventory_outbox.0.state": state,
                         "inventory_outbox.0.attempts": attempts,
                         "inventory_outbox.0.next_attempt_at": next_at,
                         "inventory_outbox.0.last_status_code": code,
                         "inventory_outbox.0.last_error": detail,
                         "inventory_outbox.0.last_attempt_at": current},
                "$unset": {"inventory_outbox.0.lease_until": ""},
            })
    return delivered


async def run_outbox(db) -> None:
    if not integration_enabled():
        return
    validate_configuration()
    timeout = httpx.Timeout(5.0, connect=3.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
        while True:
            try:
                await dispatch_once(db, client)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Inventory outbox polling failed")
            await asyncio.sleep(10)


def pending_outbox(event: dict) -> dict:
    now = datetime.now(timezone.utc)
    return {"event": event, "state": "pending", "attempts": 0,
            "next_attempt_at": now, "last_attempt_at": None,
            "last_status_code": None, "last_error": None}
