"""Customers CRUD (tenant-scoped)."""
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import get_db
from core.deps import Tenant, get_tenant, require_roles


class CustomerInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=30)
    notes: str = Field(default="", max_length=500)


class ContactImportItem(BaseModel):
    """A contact exported by the restaurant and submitted for a safe import."""
    name: str = Field(default="", max_length=120)
    phone: str = Field(min_length=1, max_length=30)


class ContactImportInput(BaseModel):
    """Structured contact import; deliberately not a WhatsApp session/API payload."""
    contacts: list[ContactImportItem] = Field(min_length=1, max_length=1000)


class ContactImportResult(BaseModel):
    created: int
    already_exists: int
    invalid: int


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


def _normalize_phone(phone: str) -> str:
    """Canonical digits used only for per-restaurant deduplication.

    The original phone remains in ``phone`` for display.  We intentionally do
    not guess a country code: imports may serve restaurants outside Brazil.
    """
    return re.sub(r"\D", "", phone)


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
async def create_customer(payload: CustomerInput, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    normalized_phone = _normalize_phone(payload.phone)
    if payload.phone.strip() and not 8 <= len(normalized_phone) <= 15:
        raise HTTPException(status_code=422, detail="Telefone inválido")
    if normalized_phone:
        existing = await db.customers.find_one(
            {"restaurant_id": tenant.restaurant_id, "normalized_phone": normalized_phone},
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(status_code=409, detail="Já existe um cliente com este telefone")
    doc = {
        "id": str(uuid.uuid4()),
        "restaurant_id": tenant.restaurant_id,
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "normalized_phone": normalized_phone,
        "notes": payload.notes.strip(),
        "created_at": now,
        "updated_at": now,
    }
    await db.customers.insert_one(doc)
    return _to_out(doc)


@router.post("/import", response_model=ContactImportResult)
async def import_contacts(
    payload: ContactImportInput,
    tenant: Tenant = Depends(require_roles("admin", "manager", "waiter")),
):
    """Import contacts into the authenticated restaurant, deduplicated by phone.

    WhatsApp Business Platform has no official endpoint that lists a business'
    device address book.  This endpoint accepts an explicit structured export
    instead, so it is usable with a permitted CSV/spreadsheet workflow and does
    not imply a WhatsApp login or scrape.
    """
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    created = already_exists = invalid = 0
    seen_phones: set[str] = set()

    for contact in payload.contacts:
        normalized_phone = _normalize_phone(contact.phone)
        if not 8 <= len(normalized_phone) <= 15:
            invalid += 1
            continue
        if normalized_phone in seen_phones:
            already_exists += 1
            continue
        seen_phones.add(normalized_phone)

        existing = await db.customers.find_one(
            {"restaurant_id": tenant.restaurant_id, "normalized_phone": normalized_phone},
            {"_id": 0, "id": 1},
        )
        if existing:
            already_exists += 1
            continue

        name = contact.name.strip() or normalized_phone
        await db.customers.insert_one({
            "id": str(uuid.uuid4()),
            "restaurant_id": tenant.restaurant_id,
            "name": name,
            "phone": contact.phone.strip(),
            "normalized_phone": normalized_phone,
            "notes": "",
            "source": "contact_import",
            "created_at": now,
            "updated_at": now,
        })
        created += 1

    return ContactImportResult(created=created, already_exists=already_exists, invalid=invalid)


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
async def update_customer(customer_id: str, payload: CustomerInput, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    db = get_db()
    normalized_phone = _normalize_phone(payload.phone)
    if payload.phone.strip() and not 8 <= len(normalized_phone) <= 15:
        raise HTTPException(status_code=422, detail="Telefone inválido")
    if normalized_phone:
        existing = await db.customers.find_one(
            {"restaurant_id": tenant.restaurant_id, "normalized_phone": normalized_phone, "id": {"$ne": customer_id}},
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(status_code=409, detail="Já existe um cliente com este telefone")
    updates = {
        "name": payload.name.strip(),
        "phone": payload.phone.strip(),
        "normalized_phone": normalized_phone,
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
