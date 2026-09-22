"""Small official Cloud API adapter; secrets live only in backend environment."""
import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

from core.db import get_db
from modules.customers.routes import _normalize_phone


def settings():
    """One Meta app; per-restaurant phone IDs and access tokens."""
    try:
        entries = json.loads(os.environ.get("WHATSAPP_TENANTS_JSON", "[]"))
        if not isinstance(entries, list):
            raise ValueError
        tenants = {}
        phones = set()
        for entry in entries:
            tenant, phone, token = (entry[key] for key in ("restaurant_id", "phone_number_id", "access_token"))
            if not all(isinstance(x, str) and x for x in (tenant, phone, token)) or tenant in tenants or phone in phones:
                raise ValueError
            tenants[tenant] = {"phone_number_id": phone, "access_token": token}
            phones.add(phone)
        return tenants
    except (ValueError, TypeError, KeyError):
        raise HTTPException(503, "Configuração WhatsApp inválida")


def tenant_for_phone(phone_number_id):
    for tenant, config in settings().items():
        if config["phone_number_id"] == phone_number_id:
            return tenant
    return None


def verify_signature(body: bytes, signature: str | None):
    secret = os.environ.get("WHATSAPP_META_APP_SECRET", "")
    if not secret or not signature or not signature.startswith("sha256="):
        raise HTTPException(403, "Webhook não autenticado")
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(403, "Webhook não autenticado")


def in_service_window(conversation):
    last = conversation.get("last_inbound_at")
    if not last:
        return False
    try:
        timestamp = datetime.fromisoformat(last)
        if timestamp.tzinfo is None:
            return False
        age = datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)
        return timedelta(0) <= age < timedelta(hours=24)
    except ValueError:
        return False


async def send_text(restaurant_id: str, phone: str, text: str):
    config = settings().get(restaurant_id)
    version = os.environ.get("WHATSAPP_GRAPH_VERSION", "")
    if not config or not re.fullmatch(r"v\d+\.\d+", version):
        raise HTTPException(503, "WhatsApp não configurado")
    url = f"https://graph.facebook.com/{version}/{config['phone_number_id']}/messages"
    if os.environ.get("DACOT_LOCAL_INTEGRATION") == "1":
        url = os.environ.get("WHATSAPP_TEST_GRAPH_URL", url).rstrip("/") + f"/{version}/{config['phone_number_id']}/messages"
    payload = {"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": text}}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(url, json=payload, headers={"Authorization": f"Bearer {config['access_token']}"})
        response.raise_for_status()
        return response.json()["messages"][0]["id"]
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        # Never echo response bodies or request headers: they may contain secrets/PII.
        raise HTTPException(502, "Falha ao enviar mensagem pelo WhatsApp")


async def notify_order(order: dict, kind: str):
    """Best-effort, one claim per order event; never blocks the order pipeline."""
    if not order.get("customer_id"):
        return
    db = get_db()
    conversation = await db.wa_conversations.find_one({
        "restaurant_id": order["restaurant_id"], "customer_id": order["customer_id"],
    })
    if not conversation:
        return
    key = f"{order['id']}:{kind}:{order['updated_at']}"
    from pymongo.errors import DuplicateKeyError
    try:
        await db.wa_notifications.insert_one({
            "restaurant_id": order["restaurant_id"], "key": key,
            "order_id": order["id"], "kind": kind, "state": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except DuplicateKeyError:
        return
    if not conversation.get("order_updates_opt_in", False):
        await db.wa_notifications.update_one(
            {"restaurant_id": order["restaurant_id"], "key": key},
            {"$set": {"state": "skipped_no_consent"}},
        )
        return
    if not in_service_window(conversation):
        await db.wa_notifications.update_one(
            {"restaurant_id": order["restaurant_id"], "key": key},
            {"$set": {"state": "skipped_outside_window"}},
        )
        return
    labels = {"created": "recebido", "in_preparation": "em preparo", "ready": "pronto", "delivered": "entregue", "cancelled": "cancelado"}
    text = f"Pedido #{order['order_number']} {labels.get(kind, kind)}."
    try:
        external_id = await send_text(order["restaurant_id"], conversation["phone"], text)
        now = datetime.now(timezone.utc).isoformat()
        await db.wa_messages.insert_one({
            "id": key, "restaurant_id": order["restaurant_id"],
            "conversation_id": conversation["id"], "direction": "outbound",
            "external_id": external_id, "type": "text", "text": text,
            "status": "sent", "created_at": now,
        })
        await db.wa_notifications.update_one(
            {"restaurant_id": order["restaurant_id"], "key": key},
            {"$set": {"state": "sent", "external_id": external_id}},
        )
    except Exception:
        await db.wa_notifications.update_one(
            {"restaurant_id": order["restaurant_id"], "key": key},
            {"$set": {"state": "failed"}},
        )
