"""MongoDB-backed guard that keeps at least one user manager per restaurant."""
from datetime import datetime, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from core.permissions import ROLE_PERMISSION_PRESETS, effective_permissions


def is_active_user_manager(user: dict | None) -> bool:
    return bool(
        user
        and user.get("active", True)
        and "users.manage" in effective_permissions(user)
    )


async def _get_or_create_guard(db, restaurant_id: str) -> dict:
    guards = db.user_manager_guards
    guard = await guards.find_one({"restaurant_id": restaurant_id}, {"_id": 0})
    if guard:
        return guard

    fallback_roles = [
        role for role, permissions in ROLE_PERMISSION_PRESETS.items()
        if "users.manage" in permissions
    ]
    managers = await db.users.find(
        {
            "restaurant_id": restaurant_id,
            "active": {"$ne": False},
            "$or": [
                {"permissions": "users.manage"},
                {"permissions": None, "role": {"$in": fallback_roles}},
            ],
        },
        {"_id": 0, "id": 1},
    ).sort([("created_at", 1), ("id", 1)]).to_list(None)

    try:
        await guards.insert_one({
            "restaurant_id": restaurant_id,
            "manager_ids": [user["id"] for user in managers],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except DuplicateKeyError:
        # Another API process initialized the same restaurant concurrently.
        pass

    guard = await guards.find_one({"restaurant_id": restaurant_id}, {"_id": 0})
    if not guard:
        raise HTTPException(status_code=503, detail="Não foi possível validar gestores do restaurante")
    return guard


async def register_user_manager(db, restaurant_id: str, user_id: str) -> None:
    await _get_or_create_guard(db, restaurant_id)
    await db.user_manager_guards.update_one(
        {"restaurant_id": restaurant_id},
        {"$addToSet": {"manager_ids": user_id}},
    )


async def unregister_user_manager(db, restaurant_id: str, user_id: str) -> None:
    await _get_or_create_guard(db, restaurant_id)
    result = await db.user_manager_guards.update_one(
        {
            "restaurant_id": restaurant_id,
            "manager_ids": user_id,
            "$expr": {"$gt": [{"$size": "$manager_ids"}, 1]},
        },
        {"$pull": {"manager_ids": user_id}},
    )
    if result.modified_count != 1:
        raise HTTPException(
            status_code=409,
            detail="Não é possível remover o último usuário ativo que gerencia usuários",
        )


async def prepare_user_manager_change(
    db,
    restaurant_id: str,
    user_id: str,
    current_user: dict,
    next_user: dict,
) -> tuple[bool, bool]:
    was_manager = is_active_user_manager(current_user)
    will_be_manager = is_active_user_manager(next_user)
    if was_manager and not will_be_manager:
        # This single-document conditional update is the cross-process invariant.
        await unregister_user_manager(db, restaurant_id, user_id)
    return was_manager, will_be_manager


async def finish_user_manager_change(
    db,
    restaurant_id: str,
    user_id: str,
    transition: tuple[bool, bool],
) -> None:
    _, will_be_manager = transition
    if will_be_manager:
        await register_user_manager(db, restaurant_id, user_id)
