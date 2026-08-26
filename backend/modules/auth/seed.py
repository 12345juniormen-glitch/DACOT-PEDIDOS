"""Seed admin user + default restaurant. Idempotent."""
import os
import uuid
from datetime import datetime, timezone

from core.db import get_db
from core.security import hash_password, verify_password


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
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    else:
        updates = {}
        if not verify_password(admin_password, existing["password_hash"]):
            updates["password_hash"] = hash_password(admin_password)
        if existing.get("restaurant_id") != restaurant_id:
            updates["restaurant_id"] = restaurant_id
        if updates:
            await db.users.update_one({"email": admin_email}, {"$set": updates})


async def ensure_indexes() -> None:
    db = get_db()
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.restaurants.create_index("id", unique=True)
    await db.products.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    await db.products.create_index([("restaurant_id", 1), ("active", 1)])
    await db.customers.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    await db.orders.create_index([("restaurant_id", 1), ("id", 1)], unique=True)
    await db.orders.create_index([("restaurant_id", 1), ("status", 1)])
    await db.orders.create_index([("restaurant_id", 1), ("created_at", -1)])
    await db.orders.create_index([("restaurant_id", 1), ("order_number", 1)], unique=True)
