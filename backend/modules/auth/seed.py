"""Seed admin user + default restaurant. Idempotent."""
import os
import re
import uuid
from datetime import datetime, timezone

from core.db import get_db
from core.security import hash_password


async def seed_admin_and_restaurant() -> None:
    db = get_db()
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@dacot.local").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    restaurant_name = os.environ.get("DEFAULT_RESTAURANT_NAME", "Restaurante Demo")

    # Restaurant
    restaurant = await db.restaurants.find_one({"name": restaurant_name})
    if not restaurant:
        restaurant = {
            "id": str(uuid.uuid4()),
            "name": restaurant_name,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.restaurants.insert_one(restaurant)
    restaurant_id = restaurant["id"]

    # Admin user
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Administrador",
            "role": "admin",
            "restaurant_id": restaurant_id,
            "active": True,
            "must_change_password": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        updates = {}
        if existing.get("restaurant_id") != restaurant_id:
            updates["restaurant_id"] = restaurant_id
        if updates:
            await db.users.update_one({"email": admin_email}, {"$set": updates})


async def ensure_indexes() -> None:
    db = get_db()
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index(
        [("restaurant_id", 1), ("hub_user_id", 1)],
        unique=True,
        partialFilterExpression={"hub_user_id": {"$exists": True}},
    )
    await db.restaurants.create_index("id", unique=True)
    await db.restaurants.create_index(
        "hub_tenant_id",
        unique=True,
        partialFilterExpression={"hub_tenant_id": {"$exists": True}},
    )
    await db.handoff_jtis.create_index("jti", unique=True)
    await db.handoff_jtis.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("expires_at", expireAfterSeconds=0)
    await db.products.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    await db.products.create_index([("restaurant_id", 1), ("active", 1)])
    await db.customers.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    # Existing installations predate ``normalized_phone``. Backfill it before
    # applying the uniqueness index so imports also deduplicate legacy clients.
    # When legacy data already contains duplicates, keep the first canonical
    # value and leave the others untouched; this avoids a risky data rewrite.
    customers = await db.customers.find(
        {}, {"_id": 0, "id": 1, "restaurant_id": 1, "phone": 1, "normalized_phone": 1}
    ).to_list(None)
    seen_phones = {
        (doc.get("restaurant_id"), doc["normalized_phone"])
        for doc in customers
        if doc.get("normalized_phone")
    }
    for customer in customers:
        if customer.get("normalized_phone") is not None:
            continue
        normalized_phone = re.sub(r"\D", "", customer.get("phone", ""))
        key = (customer.get("restaurant_id"), normalized_phone)
        if not normalized_phone or key in seen_phones:
            continue
        await db.customers.update_one(
            {"id": customer["id"], "restaurant_id": customer["restaurant_id"]},
            {"$set": {"normalized_phone": normalized_phone}},
        )
        seen_phones.add(key)
    await db.customers.create_index(
        [("restaurant_id", 1), ("normalized_phone", 1)],
        unique=True,
        partialFilterExpression={"normalized_phone": {"$gt": ""}},
    )
    await db.orders.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    await db.orders.create_index([("restaurant_id", 1), ("created_at", -1)])
    await db.orders.create_index([("restaurant_id", 1), ("status", 1), ("created_at", -1)])
    await db.orders.create_index([("restaurant_id", 1), ("customer_id", 1), ("created_at", -1)])
    await db.orders.create_index([("restaurant_id", 1), ("items.product_id", 1), ("created_at", -1)])
    await db.orders.create_index([("restaurant_id", 1), ("order_number", 1)], unique=True)
    await db.wa_conversations.create_index([("restaurant_id", 1), ("phone", 1)], unique=True)
    await db.wa_conversations.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    await db.wa_conversations.create_index([("restaurant_id", 1), ("last_message_at", -1)])
    await db.wa_messages.create_index([("restaurant_id", 1), ("external_id", 1)], unique=True)
    await db.wa_messages.create_index([("restaurant_id", 1), ("conversation_id", 1), ("created_at", -1)])
    await db.wa_notifications.create_index([("restaurant_id", 1), ("key", 1)], unique=True)
