"""Cloud API V1 integration using only loopback fake Meta endpoints."""
import hashlib
import hmac
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import jwt
import pytest
import requests
from pymongo import MongoClient

pytestmark = pytest.mark.skipif(
    os.environ.get("DACOT_LOCAL_INTEGRATION") != "1"
    or not os.environ.get("REACT_APP_BACKEND_URL", "").startswith("http://127.0.0.1:"),
    reason="Only disposable loopback integration runner",
)
API = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


def call(method, path, headers=None, **kwargs):
    return requests.request(method, API + path, headers=headers, timeout=30, **kwargs)


def session(tenant, role="waiter"):
    now = int(time.time())
    token = jwt.encode({
        "sub": f"tenant_user:{tenant}:{uuid.uuid4().hex}", "restaurant_id": tenant,
        "role": role, "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
        "exp": now + 120, "jti": uuid.uuid4().hex, "handoff_version": 1,
    }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")
    response = call("POST", "/session/exchange", json={"handoff": token})
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["token"]}


def webhook(phone_id="phone-wa-1", sender="5511999991111", text="Olá", message_id=None, name="Ana"):
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": phone_id},
        "contacts": [{"wa_id": sender, "profile": {"name": name}}],
        "messages": [{"id": message_id or "wamid." + uuid.uuid4().hex, "from": sender,
                      "timestamp": str(int(time.time())), "type": "text", "text": {"body": text}}],
    }}]}]}


def signed_post(payload, secret=None):
    raw = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(
        (secret or os.environ["WHATSAPP_META_APP_SECRET"]).encode(), raw, hashlib.sha256
    ).hexdigest()
    return call("POST", "/whatsapp/webhook", headers={"X-Hub-Signature-256": signature}, data=raw)


def test_webhook_verification_and_signature():
    good = call("GET", "/whatsapp/webhook", params={
        "hub.mode": "subscribe", "hub.verify_token": os.environ["WHATSAPP_VERIFY_TOKEN"],
        "hub.challenge": "challenge-value",
    })
    assert good.status_code == 200 and good.text == "challenge-value"
    assert call("GET", "/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "wrong"}).status_code == 403
    payload = webhook(message_id="signature-" + uuid.uuid4().hex)
    assert call("POST", "/whatsapp/webhook", json=payload).status_code == 403
    assert signed_post(payload, secret="wrong").status_code == 403
    assert signed_post(payload).status_code == 200
    assert signed_post(webhook(phone_id="not-configured")).status_code == 200


def test_inbound_duplicate_customer_lookup_and_tenant_isolation():
    first = session("wa-t1")
    other = session("wa-t2")
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    created = call("POST", "/customers", first, json={"name": "Cliente existente", "phone": phone})
    assert created.status_code == 201
    payload = webhook(sender=phone, message_id="incoming-" + uuid.uuid4().hex)
    assert signed_post(payload).status_code == 200
    assert signed_post(payload).status_code == 200
    rows = call("GET", "/whatsapp/conversations", first).json()
    conversation = next(item for item in rows if item["phone"] == phone)
    assert conversation["customer_id"] == created.json()["id"]
    assert conversation["unread"] == 1
    messages = call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", first).json()
    assert len(messages["items"]) == 1 and messages["items"][0]["text"] == "Olá"
    status_payload = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": "phone-wa-1"},
        "statuses": [{"id": "unknown-outbound", "status": "delivered", "timestamp": str(int(time.time()))}],
    }}]}]}
    assert signed_post(status_payload).status_code == 200
    assert call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", other).status_code == 404
    assert not any(item["phone"] == phone for item in call("GET", "/whatsapp/conversations", other).json())


def test_concurrent_webhook_redelivery_is_idempotent():
    waiter = session("wa-t1")
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    payload = webhook(sender=phone)
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(lambda _: signed_post(payload), range(5)))
    assert all(response.status_code == 200 for response in responses)
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    assert conversation["unread"] == 1
    assert call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", waiter).json()["total"] == 1


def test_new_customer_reply_failure_and_window():
    first = session("wa-t1")
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    assert signed_post(webhook(sender=phone)).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", first).json() if item["phone"] == phone)
    assert conversation["customer_id"] is None
    linked = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", first, json={"name": "Nova pessoa"})
    assert linked.status_code == 200
    customer = call("GET", f"/customers/{linked.json()['customer_id']}", first).json()
    assert customer["phone"] == phone and customer["name"] == "Nova pessoa"
    assert call("POST", f"/whatsapp/conversations/{conversation['id']}/order-updates-consent", first,
                json={"allowed": True}).status_code == 200
    sent = call("POST", f"/whatsapp/conversations/{conversation['id']}/messages", first, json={"text": "Recebemos sua mensagem"})
    assert sent.status_code == 201, sent.text
    assert sent.json()["direction"] == "outbound"
    status_payload = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
        "metadata": {"phone_number_id": "phone-wa-1"},
        "statuses": [{"id": sent.json()["external_id"], "status": "delivered", "timestamp": str(int(time.time()))}],
    }}]}]}
    assert signed_post(status_payload).status_code == 200
    assert signed_post(status_payload).status_code == 200
    assert any(item["status"] == "delivered" for item in call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", first).json()["items"])
    failure = call("POST", f"/whatsapp/conversations/{conversation['id']}/messages", first, json={"text": "FAIL"})
    assert failure.status_code == 502
    assert call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", first).json()["total"] == 2
    with MongoClient(os.environ["MONGO_URL"]) as client:
        client[os.environ["DB_NAME"]].wa_conversations.update_one(
            {"restaurant_id": "wa-t1", "id": conversation["id"]},
            {"$set": {"last_inbound_at": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()}},
        )
    assert call("POST", f"/whatsapp/conversations/{conversation['id']}/messages", first, json={"text": "Fora da janela"}).status_code == 409


def test_order_from_conversation_uses_normal_flow_and_notifications_are_nonblocking():
    waiter = session("wa-t1")
    kitchen = session("wa-t1", "kitchen")
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    assert signed_post(webhook(sender=phone)).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    customer_id = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter, json={}).json()["customer_id"]
    assert call("POST", f"/whatsapp/conversations/{conversation['id']}/order-updates-consent", waiter,
                json={"allowed": True}).status_code == 200
    product = call("POST", "/products", session("wa-t1", "manager"), json={"name": "Lanche", "price": 12})
    assert product.status_code == 201
    order = call("POST", "/orders", waiter, json={"customer_id": customer_id, "items": [{"product_id": product.json()["id"], "quantity": 1}]})
    assert order.status_code == 201, order.text
    oid = order.json()["id"]
    assert order.json()["customer_id"] == customer_id
    assert any(item["id"] == oid for item in call("GET", "/orders", kitchen, params={"active_only": True}).json())
    assert call("PATCH", f"/orders/{oid}/status", kitchen, json={"status": "in_preparation"}).status_code == 200
    assert call("PATCH", f"/orders/{oid}/status", kitchen, json={"status": "ready"}).status_code == 200
    assert call("PATCH", f"/orders/{oid}/status", waiter, json={"status": "delivered"}).status_code == 200
    for _ in range(30):
        rows = call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", waiter).json()["items"]
        if sum(item["direction"] == "outbound" for item in rows) == 4:
            break
        time.sleep(0.1)
    assert sum(item["direction"] == "outbound" for item in rows) == 4
    # A closed service window skips notifications, but the operational status still advances.
    with MongoClient(os.environ["MONGO_URL"]) as client:
        client[os.environ["DB_NAME"]].wa_conversations.update_one(
            {"restaurant_id": "wa-t1", "id": conversation["id"]},
            {"$set": {"last_inbound_at": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()}},
        )
    another = call("POST", "/orders", waiter, json={"customer_id": customer_id, "items": [{"product_id": product.json()["id"], "quantity": 1}]})
    assert another.status_code == 201
    with MongoClient(os.environ["MONGO_URL"]) as client:
        for _ in range(30):
            notification = client[os.environ["DB_NAME"]].wa_notifications.find_one({"order_id": another.json()["id"]})
            if notification and notification["state"] != "pending":
                break
            time.sleep(0.1)
        assert notification["state"] == "skipped_outside_window"


def test_meta_send_failure_does_not_block_status_transition():
    waiter = session("wa-t2")
    manager = session("wa-t2", "manager")
    phone = "551199990000"
    assert signed_post(webhook(phone_id="phone-wa-2", sender=phone)).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    customer_id = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter, json={}).json()["customer_id"]
    assert call("POST", f"/whatsapp/conversations/{conversation['id']}/order-updates-consent", waiter,
                json={"allowed": True}).status_code == 200
    product = call("POST", "/products", manager, json={"name": "Teste falha externa", "price": 5}).json()
    order = call("POST", "/orders", waiter, json={"customer_id": customer_id, "items": [{"product_id": product["id"], "quantity": 1}]})
    assert order.status_code == 201
    oid = order.json()["id"]
    assert call("PATCH", f"/orders/{oid}/status", waiter, json={"status": "in_preparation"}).status_code == 200
    assert call("PATCH", f"/orders/{oid}/status", waiter, json={"status": "ready"}).status_code == 200
    assert call("PATCH", f"/orders/{oid}/status", waiter, json={"status": "delivered"}).status_code == 200
    with MongoClient(os.environ["MONGO_URL"]) as client:
        for _ in range(30):
            records = list(client[os.environ["DB_NAME"]].wa_notifications.find({"order_id": oid}))
            if len(records) == 4 and all(item["state"] != "pending" for item in records):
                break
            time.sleep(0.1)
        assert len(records) == 4 and all(item["state"] == "failed" for item in records), [item["state"] for item in records]


def test_order_update_without_recorded_consent_is_not_sent():
    waiter = session("wa-t2")
    manager = session("wa-t2", "manager")
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    assert signed_post(webhook(phone_id="phone-wa-2", sender=phone)).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    customer_id = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter, json={}).json()["customer_id"]
    product = call("POST", "/products", manager, json={"name": "Sem aceite", "price": 5}).json()
    order = call("POST", "/orders", waiter, json={"customer_id": customer_id, "items": [{"product_id": product["id"], "quantity": 1}]})
    assert order.status_code == 201
    with MongoClient(os.environ["MONGO_URL"]) as client:
        for _ in range(30):
            record = client[os.environ["DB_NAME"]].wa_notifications.find_one({"order_id": order.json()["id"]})
            if record and record["state"] != "pending":
                break
            time.sleep(0.1)
        assert record["state"] == "skipped_no_consent"
    assert call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", waiter).json()["total"] == 1
