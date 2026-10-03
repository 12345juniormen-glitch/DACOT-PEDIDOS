"""Tenant-scoped WhatsApp inbox and provider-neutral event ingestion."""
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field, ValidationError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import get_db
from core.deps import Tenant, require_permissions
from modules.customers.routes import CustomerInput, _normalize_phone, create_customer
from modules.whatsapp.provider import (
    connect as provider_connect,
    connection_status,
    disconnect as provider_disconnect,
    send_text,
    verify_provider_signature,
)
from modules.whatsapp.service import get_auto_message_settings


router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
provider_router = APIRouter(prefix="/whatsapp/provider", tags=["whatsapp-provider"])


def _message_out(doc):
    return {key: doc.get(key) for key in (
        "id", "conversation_id", "direction", "external_id", "type", "text", "status", "created_at"
    )}


def _conversation_out(doc):
    return {key: doc.get(key) for key in (
        "id", "phone", "profile_name", "customer_id", "last_inbound_at", "last_message_at", "unread", "order_updates_opt_in"
    )} | {"can_reply": True}


class ProviderEvent(BaseModel):
    event: Literal["message.received", "message.status"]
    restaurant_id: str = Field(min_length=1, max_length=120)
    external_id: str = Field(min_length=1, max_length=300)
    phone: str | None = Field(default=None, max_length=30)
    profile_name: str | None = Field(default=None, max_length=120)
    message_type: str | None = Field(default=None, max_length=40)
    text: str | None = Field(default=None, max_length=4096)
    status: Literal["sent", "delivered", "read", "failed"] | None = None
    timestamp: datetime | None = None


@provider_router.post("/events")
async def receive_provider_event(
    request: Request,
    signature: str | None = Header(None, alias="X-Dacot-Provider-Signature"),
):
    body = await request.body()
    if len(body) > 256_000:
        raise HTTPException(413, "Evento grande demais")
    verify_provider_signature(body, signature)
    try:
        event = ProviderEvent.model_validate(json.loads(body))
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(400, "Evento inválido")

    db = get_db()
    if await db.restaurants.find_one({"id": event.restaurant_id}, {"_id": 1}) is None:
        raise HTTPException(404, "Restaurante não encontrado")

    if event.event == "message.status":
        if not event.status:
            raise HTTPException(400, "Status ausente")
        rank = {"sent": 1, "delivered": 2, "read": 3, "failed": 3}
        current = await db.wa_messages.find_one({
            "restaurant_id": event.restaurant_id,
            "external_id": event.external_id,
            "direction": "outbound",
        }, {"status": 1})
        if current and rank.get(current.get("status"), 0) <= rank[event.status]:
            await db.wa_messages.update_one(
                {"restaurant_id": event.restaurant_id, "external_id": event.external_id,
                 "direction": "outbound", "status": current.get("status")},
                {"$set": {"status": event.status}},
            )
        return {"ok": True}

    phone = _normalize_phone(event.phone or "")
    if not 8 <= len(phone) <= 15:
        raise HTTPException(400, "Telefone inválido")
    now = datetime.now(timezone.utc)
    at = event.timestamp.astimezone(timezone.utc) if event.timestamp else now
    if at > now:
        at = now
    at_iso, now_iso = at.isoformat(), now.isoformat()
    customer = await db.customers.find_one({
        "restaurant_id": event.restaurant_id, "normalized_phone": phone,
    }, {"id": 1})
    conversation = await db.wa_conversations.find_one_and_update(
        {"restaurant_id": event.restaurant_id, "phone": phone},
        {"$setOnInsert": {"id": str(uuid.uuid4()), "restaurant_id": event.restaurant_id,
                          "phone": phone, "unread": 0, "created_at": now_iso}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    supported = event.message_type == "text"
    doc = {
        "id": str(uuid.uuid4()), "restaurant_id": event.restaurant_id,
        "conversation_id": conversation["id"], "direction": "inbound",
        "external_id": event.external_id, "type": "text" if supported else "unsupported",
        "text": event.text if supported else None, "status": "received", "created_at": at_iso,
    }
    try:
        await db.wa_messages.insert_one(doc)
    except DuplicateKeyError:
        return {"ok": True}
    changes = {
        "$max": {"last_inbound_at": at_iso, "last_message_at": at_iso},
        "$inc": {"unread": 1},
        "$unset": {"archived_at": "", "archived_reason": ""},
    }
    fields = {}
    if event.profile_name:
        fields["profile_name"] = event.profile_name
    if customer:
        fields["customer_id"] = customer["id"]
    else:
        changes["$unset"]["customer_id"] = ""
    if fields:
        changes["$set"] = fields
    await db.wa_conversations.update_one(
        {"restaurant_id": event.restaurant_id, "id": conversation["id"]}, changes,
    )
    return {"ok": True}


@router.get("/config")
async def config_state(tenant: Tenant = Depends(require_permissions("whatsapp.view"))):
    state = await connection_status(tenant.restaurant_id)
    if not tenant.can("whatsapp.configure"):
        state.pop("qr_data_url", None)
    return state


@router.post("/connect")
async def connect_whatsapp(tenant: Tenant = Depends(require_permissions("whatsapp.configure"))):
    return await provider_connect(tenant.restaurant_id)


@router.delete("/connection")
async def disconnect_whatsapp(tenant: Tenant = Depends(require_permissions("whatsapp.configure"))):
    return await provider_disconnect(tenant.restaurant_id)


@router.get("/conversations")
async def conversations(tenant: Tenant = Depends(require_permissions("whatsapp.view"))):
    docs = await get_db().wa_conversations.find(
        {"restaurant_id": tenant.restaurant_id, "archived_at": {"$exists": False}}, {"_id": 0}
    ).sort("last_message_at", -1).limit(100).to_list(100)
    return [_conversation_out(doc) for doc in docs]


async def _conversation(tenant, conversation_id):
    doc = await get_db().wa_conversations.find_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id}, {"_id": 0}
    )
    if doc is None:
        raise HTTPException(404, "Conversa não encontrada")
    return doc


@router.get("/conversations/{conversation_id}")
async def conversation_detail(conversation_id: str, tenant: Tenant = Depends(require_permissions("whatsapp.view"))):
    return _conversation_out(await _conversation(tenant, conversation_id))


@router.get("/conversations/{conversation_id}/messages")
async def messages(conversation_id: str, tenant: Tenant = Depends(require_permissions("whatsapp.view")),
                   page: int = Query(1, ge=1)):
    await _conversation(tenant, conversation_id)
    query = {"restaurant_id": tenant.restaurant_id, "conversation_id": conversation_id}
    total = await get_db().wa_messages.count_documents(query)
    docs = await get_db().wa_messages.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * 50).limit(50).to_list(50)
    return {"items": [_message_out(doc) for doc in reversed(docs)],
            "page": page, "pages": (total + 49) // 50, "total": total}


@router.post("/conversations/{conversation_id}/read")
async def mark_read(conversation_id: str, tenant: Tenant = Depends(require_permissions("whatsapp.operate"))):
    await _conversation(tenant, conversation_id)
    await get_db().wa_conversations.update_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id}, {"$set": {"unread": 0}}
    )
    return {"ok": True}


class ConsentInput(BaseModel):
    allowed: bool


class AutoMessageSetting(BaseModel):
    enabled: bool
    message: str = Field(max_length=1000)


class AutoMessagesInput(BaseModel):
    received: AutoMessageSetting
    in_preparation: AutoMessageSetting
    ready: AutoMessageSetting
    delivered: AutoMessageSetting
    cancelled: AutoMessageSetting


ALLOWED_TEMPLATE_VARIABLES = {"cliente", "pedido", "restaurante"}


@router.get("/auto-messages")
async def auto_messages(tenant: Tenant = Depends(require_permissions("whatsapp.configure"))):
    return await get_auto_message_settings(get_db(), tenant.restaurant_id)


@router.put("/auto-messages")
async def update_auto_messages(
    payload: AutoMessagesInput,
    tenant: Tenant = Depends(require_permissions("whatsapp.configure")),
):
    messages = payload.model_dump()
    for setting in messages.values():
        if setting["enabled"] and not setting["message"].strip():
            raise HTTPException(422, "Mensagem ativa não pode ficar vazia")
        variables = {item.strip() for item in re.findall(r"{{\s*([^{}]+?)\s*}}", setting["message"])}
        unsupported = variables - ALLOWED_TEMPLATE_VARIABLES
        if unsupported:
            raise HTTPException(422, f"Variáveis não suportadas: {', '.join(sorted(unsupported))}")
    now = datetime.now(timezone.utc).isoformat()
    await get_db().wa_auto_messages.replace_one(
        {"_id": tenant.restaurant_id, "restaurant_id": tenant.restaurant_id},
        {"_id": tenant.restaurant_id, "restaurant_id": tenant.restaurant_id,
         "messages": messages, "updated_at": now, "updated_by": tenant.user_id},
        upsert=True,
    )
    return messages


@router.post("/conversations/{conversation_id}/order-updates-consent")
async def order_updates_consent(conversation_id: str, payload: ConsentInput,
                                tenant: Tenant = Depends(require_permissions("whatsapp.operate"))):
    await _conversation(tenant, conversation_id)
    at = datetime.now(timezone.utc).isoformat()
    await get_db().wa_conversations.update_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id},
        {"$set": {"order_updates_opt_in": payload.allowed, "consent_recorded_at": at,
                  "consent_recorded_by": tenant.user_id}},
    )
    return {"allowed": payload.allowed, "recorded_at": at}


class LinkCustomer(BaseModel):
    customer_id: str | None = None
    name: str | None = Field(default=None, max_length=120)


@router.post("/conversations/{conversation_id}/customer")
async def link_customer(conversation_id: str, payload: LinkCustomer,
                        tenant: Tenant = Depends(require_permissions("whatsapp.operate"))):
    conversation = await _conversation(tenant, conversation_id)
    db = get_db()
    if payload.customer_id:
        customer = await db.customers.find_one({
            "restaurant_id": tenant.restaurant_id, "id": payload.customer_id,
            "normalized_phone": conversation["phone"],
        })
        if customer is None:
            raise HTTPException(404, "Cliente com este telefone não encontrado")
        customer_id = customer["id"]
    else:
        customer = await db.customers.find_one({
            "restaurant_id": tenant.restaurant_id, "normalized_phone": conversation["phone"],
        })
        if customer is None:
            try:
                created = await create_customer(CustomerInput(
                    name=(payload.name or conversation.get("profile_name") or conversation["phone"])[:120],
                    phone=conversation["phone"],
                ), tenant)
                customer_id = created.id
            except (DuplicateKeyError, HTTPException) as exc:
                if isinstance(exc, HTTPException) and exc.status_code != 409:
                    raise
                customer = await db.customers.find_one({
                    "restaurant_id": tenant.restaurant_id, "normalized_phone": conversation["phone"],
                })
                customer_id = customer["id"]
        else:
            customer_id = customer["id"]
    await db.wa_conversations.update_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id},
        {"$set": {"customer_id": customer_id}},
    )
    return {"customer_id": customer_id}


class SendInput(BaseModel):
    text: str = Field(min_length=1, max_length=4096)


@router.post("/conversations/{conversation_id}/messages", status_code=201)
async def reply(conversation_id: str, payload: SendInput,
                tenant: Tenant = Depends(require_permissions("whatsapp.operate"))):
    conversation = await _conversation(tenant, conversation_id)
    external_id = await send_text(tenant.restaurant_id, conversation["phone"], payload.text)
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "restaurant_id": tenant.restaurant_id,
           "conversation_id": conversation_id, "direction": "outbound",
           "external_id": external_id, "type": "text", "text": payload.text,
           "status": "sent", "created_at": now, "user_id": tenant.user_id}
    try:
        await get_db().wa_messages.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(502, "Confirmação duplicada do provider")
    await get_db().wa_conversations.update_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id},
        {"$max": {"last_message_at": now}},
    )
    return _message_out(doc)
