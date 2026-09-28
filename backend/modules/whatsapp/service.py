"""Transport-independent WhatsApp domain services."""
import re
from datetime import datetime, timezone

from core.db import get_db
from modules.whatsapp.provider import send_text


DEFAULT_AUTO_MESSAGES = {
    "received": {
        "enabled": True,
        "message": "Olá, {{cliente}}! Seu pedido {{pedido}} foi recebido por {{restaurante}}.",
    },
    "in_preparation": {
        "enabled": True,
        "message": "Olá, {{cliente}}! Seu pedido {{pedido}} está em preparo.",
    },
    "ready": {
        "enabled": True,
        "message": "Olá, {{cliente}}! Seu pedido {{pedido}} está pronto.",
    },
    "delivered": {
        "enabled": True,
        "message": "Olá, {{cliente}}! Seu pedido {{pedido}} foi entregue. Obrigado!",
    },
    "cancelled": {
        "enabled": True,
        "message": "Olá, {{cliente}}. Seu pedido {{pedido}} foi cancelado.",
    },
}

EVENT_TO_SETTING = {
    "created": "received",
    "in_preparation": "in_preparation",
    "ready": "ready",
    "delivered": "delivered",
    "cancelled": "cancelled",
}


async def get_auto_message_settings(db, restaurant_id: str) -> dict:
    stored = await db.wa_auto_messages.find_one(
        {"_id": restaurant_id, "restaurant_id": restaurant_id}, {"_id": 0, "messages": 1}
    )
    overrides = (stored or {}).get("messages", {})
    return {
        key: {**default, **overrides.get(key, {})}
        for key, default in DEFAULT_AUTO_MESSAGES.items()
    }


def render_order_message(template: str, order: dict, restaurant_name: str) -> str:
    values = {
        "cliente": order.get("customer_name") or "cliente",
        "pedido": f"#{order['order_number']}",
        "restaurante": restaurant_name or "restaurante",
    }
    return re.sub(
        r"{{\s*(cliente|pedido|restaurante)\s*}}",
        lambda match: str(values[match.group(1)]),
        template,
    )


async def notify_order(order: dict, kind: str):
    """Best-effort, idempotent order notification; never blocks order flow."""
    if not order.get("customer_id"):
        return
    db = get_db()
    conversation = await db.wa_conversations.find_one({
        "restaurant_id": order["restaurant_id"], "customer_id": order["customer_id"],
    })
    if not conversation:
        return
    setting_key = EVENT_TO_SETTING.get(kind)
    if not setting_key:
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
    settings = await get_auto_message_settings(db, order["restaurant_id"])
    setting = settings[setting_key]
    if not setting["enabled"]:
        await db.wa_notifications.update_one(
            {"restaurant_id": order["restaurant_id"], "key": key},
            {"$set": {"state": "skipped_disabled"}},
        )
        return
    if not conversation.get("order_updates_opt_in", False):
        await db.wa_notifications.update_one(
            {"restaurant_id": order["restaurant_id"], "key": key},
            {"$set": {"state": "skipped_no_consent"}},
        )
        return
    restaurant = await db.restaurants.find_one(
        {"id": order["restaurant_id"]}, {"_id": 0, "name": 1}
    )
    text = render_order_message(
        setting["message"], order, (restaurant or {}).get("name", "restaurante")
    )
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
