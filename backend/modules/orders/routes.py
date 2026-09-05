"""Orders service — the core of the module.

- Values stored as integer cents (`*_cents` suffix).
- Product & customer snapshots stored on each order item so historical orders
  remain consistent even when products/customers change later.
- Cancellation is non-destructive: sets status='cancelled' + `cancelled_at`.
- Status transitions are validated to keep data consistent.
"""
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import get_db
from core.deps import Tenant, get_tenant, require_roles
from core.money import cents_to_reais, reais_to_cents


OrderStatus = Literal["new", "in_preparation", "ready", "delivered", "cancelled"]
DiscountType = Literal["none", "fixed", "percent"]

# Day boundary for "today's revenue" is computed in the restaurant's local timezone,
# not UTC — otherwise the day rolls over 3h early (America/Sao_Paulo = UTC-3).
RESTAURANT_TZ = ZoneInfo("America/Sao_Paulo")

# status transitions allowed (source -> allowed targets)
# Backward moves are allowed within the active kitchen pipeline (new <-> in_preparation <-> ready)
# so an accidental advance can be undone. delivered/cancelled stay terminal — delivered feeds
# revenue reporting and cancellation is documented/communicated to users as final.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "new": {"in_preparation", "cancelled"},
    "in_preparation": {"new", "ready", "cancelled"},
    "ready": {"in_preparation", "delivered", "cancelled"},
    "delivered": set(),
    "cancelled": set(),
}


# ---------- Schemas ----------
class OrderItemInput(BaseModel):
    product_id: str
    quantity: int = Field(gt=0, le=999)
    notes: str = Field(default="", max_length=300)


class OrderCreateInput(BaseModel):
    customer_id: Optional[str] = None
    items: list[OrderItemInput] = Field(min_length=1)
    notes: str = Field(default="", max_length=500)
    discount_type: DiscountType = "none"
    discount_value: float = Field(default=0, ge=0)


class OrderUpdateInput(BaseModel):
    """Edit an existing order (only allowed while status in {new, in_preparation})."""
    customer_id: Optional[str] = None
    items: list[OrderItemInput] = Field(min_length=1)
    notes: str = Field(default="", max_length=500)
    discount_type: DiscountType = "none"
    discount_value: float = Field(default=0, ge=0)


class OrderStatusInput(BaseModel):
    status: OrderStatus


class OrderItemOut(BaseModel):
    product_id: str
    product_name: str
    unit_price: float
    quantity: int
    line_total: float
    notes: str


class OrderOut(BaseModel):
    id: str
    order_number: int
    customer_id: Optional[str]
    customer_name: Optional[str]
    items: list[OrderItemOut]
    notes: str
    subtotal: float
    discount_type: DiscountType
    discount_value: float
    discount_amount: float
    total: float
    status: OrderStatus
    created_at: str
    updated_at: str
    cancelled_at: Optional[str] = None


# ---------- Helpers ----------
def _compute_totals(items_docs: list[dict], discount_type: str, discount_value: float) -> tuple[int, int, int]:
    subtotal_cents = sum(i["unit_price_cents"] * i["quantity"] for i in items_docs)
    if discount_type == "fixed":
        discount_cents = min(reais_to_cents(discount_value), subtotal_cents)
    elif discount_type == "percent":
        pct = max(0.0, min(100.0, float(discount_value)))
        discount_cents = int(round(subtotal_cents * pct / 100.0))
    else:
        discount_cents = 0
    total_cents = max(0, subtotal_cents - discount_cents)
    return subtotal_cents, discount_cents, total_cents


async def _build_items_snapshot(db, restaurant_id: str, items_input: list[OrderItemInput]) -> list[dict]:
    ids = list({i.product_id for i in items_input})
    products = await db.products.find(
        {"restaurant_id": restaurant_id, "id": {"$in": ids}}, {"_id": 0}
    ).to_list(1000)
    by_id = {p["id"]: p for p in products}
    missing = [pid for pid in ids if pid not in by_id]
    if missing:
        raise HTTPException(status_code=400, detail=f"Produtos não encontrados: {missing}")
    inactive = [by_id[pid]["name"] for pid in ids if not by_id[pid].get("active", True)]
    if inactive:
        raise HTTPException(status_code=400, detail=f"Produtos inativos não podem ser vendidos: {inactive}")

    snapshot: list[dict] = []
    for item in items_input:
        p = by_id[item.product_id]
        snapshot.append({
            "product_id": p["id"],
            "product_name": p["name"],
            "unit_price_cents": int(p["price_cents"]),
            "quantity": int(item.quantity),
            "notes": item.notes.strip(),
        })
    return snapshot


def _to_out(doc: dict) -> OrderOut:
    items_out = [
        OrderItemOut(
            product_id=i["product_id"],
            product_name=i["product_name"],
            unit_price=cents_to_reais(i["unit_price_cents"]),
            quantity=i["quantity"],
            line_total=cents_to_reais(i["unit_price_cents"] * i["quantity"]),
            notes=i.get("notes", ""),
        )
        for i in doc["items"]
    ]
    return OrderOut(
        id=doc["id"],
        order_number=doc["order_number"],
        customer_id=doc.get("customer_id"),
        customer_name=doc.get("customer_name"),
        items=items_out,
        notes=doc.get("notes", ""),
        subtotal=cents_to_reais(doc["subtotal_cents"]),
        discount_type=doc.get("discount_type", "none"),
        discount_value=float(doc.get("discount_value", 0)),
        discount_amount=cents_to_reais(doc.get("discount_cents", 0)),
        total=cents_to_reais(doc["total_cents"]),
        status=doc["status"],
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        cancelled_at=doc.get("cancelled_at"),
    )


async def _next_order_number(db, restaurant_id: str) -> int:
    """Atomically allocate the next order_number for a restaurant.

    The previous implementation read the current max order_number and used
    max+1 as the new one — a classic read-then-write race: two requests
    arriving close together can read the same max and both try to insert the
    same order_number, and only the unique (restaurant_id, order_number)
    index on `orders` caught it, surfacing as an unhandled DuplicateKeyError
    (raw HTTP 500).

    This version keeps a per-restaurant counter in `order_counters` (`_id` =
    restaurant_id, `seq` = last number issued) and allocates via a single
    atomic `$inc` (findAndModify), which MongoDB serializes per document —
    two concurrent callers can never be handed the same value. The counter
    is bootstrapped once per restaurant from the current max order_number
    (or 1000, so the first order is still 1001, preserving today's format
    and sequence) via an idempotent `$setOnInsert` upsert; MongoDB itself
    serializes concurrent upserts racing on the same _id, so the bootstrap
    is race-safe too.
    """
    counters = db.order_counters
    if await counters.find_one({"_id": restaurant_id}, {"_id": 1}) is None:
        last = await db.orders.find_one(
            {"restaurant_id": restaurant_id},
            sort=[("order_number", -1)],
            projection={"order_number": 1},
        )
        start = last["order_number"] if last else 1000
        await counters.find_one_and_update(
            {"_id": restaurant_id},
            {"$setOnInsert": {"seq": start}},
            upsert=True,
        )
    result = await counters.find_one_and_update(
        {"_id": restaurant_id},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    return result["seq"]


async def _load_customer(db, restaurant_id: str, customer_id: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not customer_id:
        return None, None
    c = await db.customers.find_one(
        {"id": customer_id, "restaurant_id": restaurant_id}, {"_id": 0, "name": 1, "id": 1}
    )
    if not c:
        raise HTTPException(status_code=400, detail="Cliente não encontrado")
    return c["id"], c["name"]


# ---------- Routes ----------
router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=list[OrderOut])
async def list_orders(
    tenant: Tenant = Depends(get_tenant),
    status_filter: Optional[str] = Query(None, alias="status"),
    active_only: bool = Query(False, description="Se true, oculta 'delivered' e 'cancelled'"),
    customer_id: Optional[str] = Query(None, description="Filtra pelo histórico de um cliente"),
    search: str = Query("", max_length=120),
    limit: int = Query(200, ge=1, le=1000),
):
    db = get_db()
    # restaurant_id vem sempre do tenant autenticado (JWT), nunca de entrada do cliente —
    # um customer_id de outro tenant simplesmente não bate com nenhum pedido aqui.
    q: dict = {"restaurant_id": tenant.restaurant_id}
    if status_filter:
        q["status"] = status_filter
    elif active_only:
        q["status"] = {"$in": ["new", "in_preparation", "ready"]}
    if customer_id:
        q["customer_id"] = customer_id
    if search.strip():
        s = search.strip()
        # try order_number match
        or_clauses = [
            {"customer_name": {"$regex": s, "$options": "i"}},
        ]
        if s.isdigit():
            or_clauses.append({"order_number": int(s)})
        q["$or"] = or_clauses
    docs = await db.orders.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return [_to_out(d) for d in docs]


@router.get("/stats")
async def orders_stats(tenant: Tenant = Depends(require_roles("admin", "manager"))):
    db = get_db()
    pipeline = [
        {"$match": {"restaurant_id": tenant.restaurant_id}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    result = {"new": 0, "in_preparation": 0, "ready": 0, "delivered": 0, "cancelled": 0}
    async for row in db.orders.aggregate(pipeline):
        result[row["_id"]] = row["count"]
    # today's revenue (delivered only) — day boundary is local midnight, converted to UTC
    today_start = (
        datetime.now(RESTAURANT_TZ)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc)
        .isoformat()
    )
    today_pipeline = [
        {"$match": {
            "restaurant_id": tenant.restaurant_id,
            "status": "delivered",
            "created_at": {"$gte": today_start},
        }},
        {"$group": {"_id": None, "total": {"$sum": "$total_cents"}}},
    ]
    revenue_cents = 0
    async for row in db.orders.aggregate(today_pipeline):
        revenue_cents = row["total"]
    result["today_revenue"] = cents_to_reais(revenue_cents)
    return result


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(payload: OrderCreateInput, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    db = get_db()
    items_snap = await _build_items_snapshot(db, tenant.restaurant_id, payload.items)
    subtotal_c, discount_c, total_c = _compute_totals(items_snap, payload.discount_type, payload.discount_value)
    customer_id, customer_name = await _load_customer(db, tenant.restaurant_id, payload.customer_id)
    now = datetime.now(timezone.utc).isoformat()
    order_number = await _next_order_number(db, tenant.restaurant_id)
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "order_number": order_number,
        "customer_id": customer_id,
        "customer_name": customer_name,
        "items": items_snap,
        "notes": payload.notes.strip(),
        "subtotal_cents": subtotal_c,
        "discount_type": payload.discount_type,
        "discount_value": payload.discount_value if payload.discount_type != "none" else 0,
        "discount_cents": discount_c,
        "total_cents": total_c,
        "status": "new",
        "created_at": now,
        "updated_at": now,
        "created_by": tenant.user_id,
    }
    await db.orders.insert_one(doc)
    return _to_out(doc)


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(order_id: str, tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    doc = await db.orders.find_one({"id": order_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return _to_out(doc)


@router.put("/{order_id}", response_model=OrderOut)
async def update_order(order_id: str, payload: OrderUpdateInput, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    db = get_db()
    existing = await db.orders.find_one({"id": order_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    if existing["status"] not in {"new", "in_preparation"}:
        raise HTTPException(status_code=409, detail="Pedido não pode ser editado neste status")

    items_snap = await _build_items_snapshot(db, tenant.restaurant_id, payload.items)
    subtotal_c, discount_c, total_c = _compute_totals(items_snap, payload.discount_type, payload.discount_value)
    customer_id, customer_name = await _load_customer(db, tenant.restaurant_id, payload.customer_id)

    updates = {
        "customer_id": customer_id,
        "customer_name": customer_name,
        "items": items_snap,
        "notes": payload.notes.strip(),
        "subtotal_cents": subtotal_c,
        "discount_type": payload.discount_type,
        "discount_value": payload.discount_value if payload.discount_type != "none" else 0,
        "discount_cents": discount_c,
        "total_cents": total_c,
        # updated_at is intentionally NOT touched here: it marks "entered current status
        # at" (set only by change_status below) and the KDS elapsed-time indicator relies
        # on that to time how long an order has been in_preparation/ready. Editing an
        # order's content is not a status change.
    }
    updated = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    return _to_out(updated)


@router.patch("/{order_id}/status", response_model=OrderOut)
async def change_status(order_id: str, payload: OrderStatusInput, tenant: Tenant = Depends(get_tenant)):
    # Kitchen: can move within the active pipeline (advance new→in_preparation→ready, or roll
    # back a mistaken advance) but never touch the terminal states delivered/cancelled.
    # The origin check is enforced by ALLOWED_TRANSITIONS below (kitchen can't skip states).
    if tenant.role == "kitchen" and payload.status not in {"new", "in_preparation", "ready"}:
        raise HTTPException(status_code=403, detail="Cozinha só pode iniciar preparo, marcar como Pronto ou desfazer esses passos")
    db = get_db()
    existing = await db.orders.find_one({"id": order_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    current = existing["status"]
    target = payload.status
    if target == current:
        return _to_out(existing)
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise HTTPException(status_code=409, detail=f"Transição inválida: {current} → {target}")

    updates: dict = {"status": target, "updated_at": datetime.now(timezone.utc).isoformat()}
    if target == "cancelled":
        updates["cancelled_at"] = updates["updated_at"]
    if target == "delivered":
        updates["delivered_at"] = updates["updated_at"]

    updated = await db.orders.find_one_and_update(
        {"id": order_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    return _to_out(updated)


@router.post("/{order_id}/cancel", response_model=OrderOut)
async def cancel_order(order_id: str, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    return await change_status(order_id, OrderStatusInput(status="cancelled"), tenant)


@router.post("/{order_id}/duplicate", response_model=OrderOut, status_code=201)
async def duplicate_order(order_id: str, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    db = get_db()
    src = await db.orders.find_one({"id": order_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")

    # rebuild items from current product prices (only active products)
    items_input = [OrderItemInput(product_id=i["product_id"], quantity=i["quantity"], notes=i.get("notes", "")) for i in src["items"]]
    items_snap = await _build_items_snapshot(db, tenant.restaurant_id, items_input)
    discount_type = src.get("discount_type", "none")
    discount_value = float(src.get("discount_value", 0))
    subtotal_c, discount_c, total_c = _compute_totals(items_snap, discount_type, discount_value)
    now = datetime.now(timezone.utc).isoformat()
    order_number = await _next_order_number(db, tenant.restaurant_id)

    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "order_number": order_number,
        "customer_id": src.get("customer_id"),
        "customer_name": src.get("customer_name"),
        "items": items_snap,
        "notes": src.get("notes", ""),
        "subtotal_cents": subtotal_c,
        "discount_type": discount_type,
        "discount_value": discount_value,
        "discount_cents": discount_c,
        "total_cents": total_c,
        "status": "new",
        "created_at": now,
        "updated_at": now,
        "created_by": tenant.user_id,
        "duplicated_from": src["id"],
    }
    await db.orders.insert_one(doc)
    return _to_out(doc)
