"""Customers CRUD (tenant-scoped)."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import get_db
from core.deps import Tenant, get_tenant


class CustomerInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=30)
    notes: str = Field(default="", max_length=500)


class CustomerOut(BaseModel):
    id: str
    name: str
    phone: str
    notes: str
    created_at: str
    updated_at: str


def _to_out(doc: dict) -> CustomerOut:
    return CustomerOut(
        id=doc["id"],
        name=doc["name"],
        phone=doc.get("phone", ""),
        notes=doc.get("notes", ""),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[CustomerOut])
async def list_customers(tenant: Tenant = Depends(get_tenant), search: str = Query("", max_length=120)):
    db = get_db()
    q: dict = {"restaurant_id": tenant.restaurant_id}
    if search.strip():
        q["$or"] = [
            {"name": {"$regex": search.strip(), "$options": "i"}},
            {"phone": {"$regex": search.strip(), "$options": "i"}},
        ]
    docs = await db.customers.find(q, {"_id": 0}).sort("name", 1).to_list(1000)
    return [_to_out(d) for d in docs]


@router.post("", response_model=CustomerOut, status_code=201)
async def create_customer(payload: CustomerInput, tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "notes": payload.notes.strip(),
        "created_at": now,
        "updated_at": now,
    }
    await db.customers.insert_one(doc)
    return _to_out(doc)


@router.get("/{customer_id}", response_model=CustomerOut)
async def get_customer(customer_id: str, tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    doc = await db.customers.find_one(
        {"id": customer_id, "restaurant_id": tenant.restaurant_id}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return _to_out(doc)


@router.put("/{customer_id}", response_model=CustomerOut)
async def update_customer(customer_id: str, payload: CustomerInput, tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    updates = {
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "notes": payload.notes.strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = await db.customers.find_one_and_update(
        {"id": customer_id, "restaurant_id": tenant.restaurant_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    return _to_out(result)
