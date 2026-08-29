"""Products CRUD (tenant-scoped)."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import get_db
from core.deps import Tenant, get_tenant, require_roles
from core.money import cents_to_reais, reais_to_cents


class ProductInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    price: float = Field(ge=0)
    category: str = Field(default="Geral", max_length=60)
    active: bool = True


class ProductOut(BaseModel):
    id: str
    name: str
    description: str
    price: float
    category: str
    active: bool
    created_at: str
    updated_at: str


def _to_out(doc: dict) -> ProductOut:
    return ProductOut(
        id=doc["id"],
        name=doc["name"],
        description=doc.get("description", ""),
        price=cents_to_reais(doc["price_cents"]),
        category=doc.get("category", "Geral"),
        active=doc.get("active", True),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductOut])
async def list_products(
    tenant: Tenant = Depends(get_tenant),
    active_only: bool = Query(False, description="Se true, retorna apenas produtos ativos"),
    category: Optional[str] = None,
):
    db = get_db()
    q: dict = {"restaurant_id": tenant.restaurant_id}
    if active_only:
        q["active"] = True
    if category:
        q["category"] = category
    docs = await db.products.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    return [_to_out(d) for d in docs]


@router.post("", response_model=ProductOut, status_code=201)
async def create_product(payload: ProductInput, tenant: Tenant = Depends(require_roles("admin", "manager"))):
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "name": payload.name.strip(),
        "description": payload.description.strip(),
        "price_cents": reais_to_cents(payload.price),
        "category": payload.category.strip() or "Geral",
        "active": payload.active,
        "created_at": now,
        "updated_at": now,
    }
    await db.products.insert_one(doc)
    return _to_out(doc)


@router.get("/categories", response_model=list[str])
async def list_categories(tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    cats = await db.products.distinct("category", {"restaurant_id": tenant.restaurant_id})
    return sorted([c for c in cats if c])


@router.get("/{product_id}", response_model=ProductOut)
async def get_product(product_id: str, tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    doc = await db.products.find_one(
        {"id": product_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return _to_out(doc)


@router.put("/{product_id}", response_model=ProductOut)
async def update_product(product_id: str, payload: ProductInput, tenant: Tenant = Depends(require_roles("admin", "manager"))):
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    updates = {
        "name": payload.name.strip(),
        "description": payload.description.strip(),
        "price_cents": reais_to_cents(payload.price),
        "category": payload.category.strip() or "Geral",
        "active": payload.active,
        "updated_at": now,
    }
    result = await db.products.find_one_and_update(
        {"id": product_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return _to_out(result)


@router.delete("/{product_id}", status_code=204)
async def deactivate_product(product_id: str, tenant: Tenant = Depends(require_roles("admin", "manager"))):
    """Soft delete: marca como inativo (não some do histórico)."""
    db = get_db()
    result = await db.products.update_one(
        {"id": product_id, "restaurant_id": tenant.restaurant_id},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    return None
