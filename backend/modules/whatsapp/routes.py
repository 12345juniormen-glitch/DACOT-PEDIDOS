"""Meta Cloud API webhook and tenant-scoped operator inbox."""
import json
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core.db import get_db
from core.deps import Tenant, require_roles
from modules.customers.routes import CustomerInput, _normalize_phone, create_customer
from modules.whatsapp.service import in_service_window, send_text, settings, tenant_for_phone, verify_signature


router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
webhook_router = APIRouter(prefix="/whatsapp/webhook", tags=["whatsapp-webhook"])


def _message_out(doc):
    return {key: doc.get(key) for key in (
        "id", "conversation_id", "direction", "external_id", "type", "text", "status", "created_at"
    )}


def _conversation_out(doc):
    return {key: doc.get(key) for key in (
        "id", "phone", "profile_name", "customer_id", "last_inbound_at", "last_message_at", "unread", "order_updates_opt_in"
    )} | {"can_reply": in_service_window(doc)}


@webhook_router.get("", response_class=PlainTextResponse)
async def verify_webhook(
    mode: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge"),
):
    expected = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
    if not expected or mode != "subscribe" or token != expected:
        raise HTTPException(403, "Verificação recusada")
    return challenge


@webhook_router.post("")
async def receive_webhook(request: Request, signature: str | None = Header(None, alias="X-Hub-Signature-256")):
    body = await request.body()
    if len(body) > 256_000:
        raise HTTPException(413, "Webhook grande demais")
    verify_signature(body, signature)
    try:
        payload = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Webhook inválido")
    if payload.get("object") != "whatsapp_business_account":
        raise HTTPException(400, "Objeto inesperado")
    db = get_db()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            if change.get("field") != "messages":
                continue
            value = change.get("value", {})
            restaurant_id = tenant_for_phone(value.get("metadata", {}).get("phone_number_id"))
            if not restaurant_id:
                # A signed event for an unconfigured number is never assigned to a tenant.
                continue
            profiles = {c.get("wa_id"): c.get("profile", {}).get("name", "")[:120]
                        for c in value.get("contacts", [])}
            for message in value.get("messages", []):
                external_id = message.get("id")
                phone = _normalize_phone(message.get("from", ""))
                if not external_id or not 8 <= len(phone) <= 15:
                    continue
                now = datetime.now(timezone.utc).isoformat()
                try:
                    at = datetime.fromtimestamp(int(message.get("timestamp", 0)), timezone.utc).isoformat()
                except (ValueError, TypeError, OverflowError):
                    at = now
                if at > now:
                    at = now
                customer = await db.customers.find_one({
                    "restaurant_id": restaurant_id, "normalized_phone": phone,
                }, {"id": 1})
                conversation = await db.wa_conversations.find_one_and_update(
                    {"restaurant_id": restaurant_id, "phone": phone},
                    {"$setOnInsert": {"id": str(uuid.uuid4()), "restaurant_id": restaurant_id,
                                      "phone": phone, "unread": 0, "created_at": now}},
                    upsert=True, return_document=True,
                )
                kind = message.get("type", "unsupported")
                supported = kind == "text"
                doc = {"id": str(uuid.uuid4()), "restaurant_id": restaurant_id,
                       "conversation_id": conversation["id"], "direction": "inbound",
                       "external_id": external_id, "type": kind if supported else "unsupported",
                       "text": message.get("text", {}).get("body", "")[:4096] if supported else None,
                       "status": "received", "created_at": at}
                try:
                    await db.wa_messages.insert_one(doc)
                except DuplicateKeyError:
                    continue
                changes = {"$max": {"last_inbound_at": at, "last_message_at": at},
                           "$inc": {"unread": 1}}
                fields = {}
                if profiles.get(message.get("from")):
                    fields["profile_name"] = profiles[message["from"]]
                if customer:
                    fields["customer_id"] = customer["id"]
                if fields:
                    changes["$set"] = fields
                await db.wa_conversations.update_one(
                    {"restaurant_id": restaurant_id, "id": conversation["id"]}, changes,
                )
            for event in value.get("statuses", []):
                external_id, state = event.get("id"), event.get("status")
                if external_id and state in {"sent", "delivered", "read", "failed"}:
                    rank = {"sent": 1, "delivered": 2, "read": 3, "failed": 3}
                    current = await db.wa_messages.find_one({
                        "restaurant_id": restaurant_id, "external_id": external_id, "direction": "outbound",
                    }, {"status": 1})
                    if current and rank.get(current.get("status"), 0) <= rank[state]:
                        await db.wa_messages.update_one(
                            {"restaurant_id": restaurant_id, "external_id": external_id,
                             "direction": "outbound", "status": current.get("status")},
                            {"$set": {"status": state}},
                        )
    return {"ok": True}


@router.get("/config")
async def config_state(tenant: Tenant = Depends(require_roles("admin", "manager"))):
    config = settings().get(tenant.restaurant_id)
    return {"connected": bool(config), "phone_number_id": config["phone_number_id"] if config else None}


@router.get("/conversations")
async def conversations(tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    docs = await get_db().wa_conversations.find(
        {"restaurant_id": tenant.restaurant_id}, {"_id": 0}
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
async def conversation_detail(conversation_id: str, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    return _conversation_out(await _conversation(tenant, conversation_id))


@router.get("/conversations/{conversation_id}/messages")
async def messages(conversation_id: str, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter")),
                   page: int = Query(1, ge=1)):
    await _conversation(tenant, conversation_id)
    query = {"restaurant_id": tenant.restaurant_id, "conversation_id": conversation_id}
    total = await get_db().wa_messages.count_documents(query)
    docs = await get_db().wa_messages.find(query, {"_id": 0}).sort("created_at", -1).skip((page - 1) * 50).limit(50).to_list(50)
    return {"items": [_message_out(doc) for doc in reversed(docs)],
            "page": page, "pages": (total + 49) // 50, "total": total}


@router.post("/conversations/{conversation_id}/read")
async def mark_read(conversation_id: str, tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    await _conversation(tenant, conversation_id)
    await get_db().wa_conversations.update_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id}, {"$set": {"unread": 0}}
    )
    return {"ok": True}


class ConsentInput(BaseModel):
    allowed: bool


@router.post("/conversations/{conversation_id}/order-updates-consent")
async def order_updates_consent(conversation_id: str, payload: ConsentInput,
                                tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
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
                        tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
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
                tenant: Tenant = Depends(require_roles("admin", "manager", "waiter"))):
    conversation = await _conversation(tenant, conversation_id)
    if not in_service_window(conversation):
        raise HTTPException(409, "Janela de atendimento encerrada; é necessário template aprovado")
    external_id = await send_text(tenant.restaurant_id, conversation["phone"], payload.text)
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "restaurant_id": tenant.restaurant_id,
           "conversation_id": conversation_id, "direction": "outbound",
           "external_id": external_id, "type": "text", "text": payload.text,
           "status": "sent", "created_at": now, "user_id": tenant.user_id}
    try:
        await get_db().wa_messages.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(502, "Confirmação duplicada da API externa")
    await get_db().wa_conversations.update_one(
        {"restaurant_id": tenant.restaurant_id, "id": conversation_id},
        {"$max": {"last_message_at": now}},
    )
    return _message_out(doc)
