"""Provider-neutral WhatsApp integration using loopback-only fakes."""
import hashlib
import hmac
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

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
PROVIDER = os.environ.get("WHATSAPP_PROVIDER_URL", "").rstrip("/")


def call(method, path, headers=None, **kwargs):
    return requests.request(method, API + path, headers=headers, timeout=30, **kwargs)


def session(tenant, role="waiter"):
    now = int(time.time())
    token = jwt.encode({
        "sub": f"tenant_user:{tenant}:{uuid.uuid4().hex}", "restaurant_id": tenant,
        "role": role, "module": "orders", "iss": os.environ["HANDOFF_ISSUER"],
        "aud": os.environ["HANDOFF_AUDIENCE"], "iat": now, "nbf": now - 5,
        "exp": now + 60, "jti": uuid.uuid4().hex, "handoff_version": 1,
        "hub_access": {"user": 1, "tenant": 1, "module": 1},
    }, os.environ["HANDOFF_JWT_SECRET"], algorithm="HS256")
    response = call("POST", "/session/exchange", json={"handoff": token})
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["token"]}


def tenant_id():
    return uuid.uuid4().hex[:24]


def set_provider_state(tenant, state="connected"):
    response = requests.post(
        f"{PROVIDER}/test/provider/{tenant}/{state}",
        headers={"X-Test-Control": os.environ["WHATSAPP_TEST_CONTROL_SECRET"]},
        timeout=10,
    )
    assert response.status_code == 200, response.text


def provider_event(tenant, phone="5511999991111", text="Olá", message_id=None, name="Ana", secret=None):
    payload = {
        "event": "message.received", "restaurant_id": tenant,
        "external_id": message_id or "baileys." + uuid.uuid4().hex,
        "phone": phone, "profile_name": name, "message_type": "text",
        "text": text, "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = "sha256=" + hmac.new(
        (secret or os.environ["WHATSAPP_PROVIDER_SECRET"]).encode(), raw, hashlib.sha256,
    ).hexdigest()
    return call("POST", "/whatsapp/provider/events",
                headers={"X-Dacot-Provider-Signature": signature, "Content-Type": "application/json"}, data=raw)


def status_event(tenant, external_id, status):
    payload = {"event": "message.status", "restaurant_id": tenant,
               "external_id": external_id, "status": status,
               "timestamp": datetime.now(timezone.utc).isoformat()}
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = "sha256=" + hmac.new(
        os.environ["WHATSAPP_PROVIDER_SECRET"].encode(), raw, hashlib.sha256,
    ).hexdigest()
    return call("POST", "/whatsapp/provider/events",
                headers={"X-Dacot-Provider-Signature": signature, "Content-Type": "application/json"}, data=raw)


def test_connection_disconnect_reconnect_rbac_and_tenant_isolation():
    first_tenant, second_tenant = tenant_id(), tenant_id()
    manager = session(first_tenant, "manager")
    waiter = session(first_tenant, "waiter")
    kitchen = session(first_tenant, "kitchen")
    other_manager = session(second_tenant, "manager")
    set_provider_state(first_tenant)
    set_provider_state(second_tenant)

    assert call("GET", "/whatsapp/config", manager).json()["connected"] is True
    assert call("GET", "/whatsapp/config", other_manager).json()["connected"] is True
    assert call("GET", "/whatsapp/config", kitchen).status_code == 403
    assert call("POST", "/whatsapp/connect", waiter).status_code == 403
    assert call("DELETE", "/whatsapp/connection", waiter).status_code == 403

    disconnected = call("DELETE", "/whatsapp/connection", manager)
    assert disconnected.status_code == 200 and disconnected.json()["state"] == "disconnected"
    assert call("GET", "/whatsapp/config", other_manager).json()["connected"] is True

    waiting = call("POST", "/whatsapp/connect", manager)
    assert waiting.status_code == 200 and waiting.json()["state"] == "waiting_qr"
    assert waiting.json()["qr_data_url"].startswith("data:image/png;base64,")
    assert "qr_data_url" not in call("GET", "/whatsapp/config", waiter).json()
    set_provider_state(first_tenant, "reconnecting")
    assert call("GET", "/whatsapp/config", manager).json()["state"] == "reconnecting"
    set_provider_state(first_tenant, "connected")
    assert call("GET", "/whatsapp/config", manager).json()["connected"] is True


def test_inbound_dedup_customer_lookup_and_tenant_isolation():
    first_tenant, second_tenant = tenant_id(), tenant_id()
    first = session(first_tenant)
    other = session(second_tenant)
    set_provider_state(first_tenant)
    set_provider_state(second_tenant)
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    created = call("POST", "/customers", first, json={"name": "Cliente existente", "phone": phone})
    assert created.status_code == 201
    message_id = "incoming-" + uuid.uuid4().hex
    assert provider_event(first_tenant, phone=phone, message_id=message_id).status_code == 200
    assert provider_event(first_tenant, phone=phone, message_id=message_id).status_code == 200
    rows = call("GET", "/whatsapp/conversations", first).json()
    conversation = next(item for item in rows if item["phone"] == phone)
    assert conversation["customer_id"] == created.json()["id"] and conversation["unread"] == 1
    messages = call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", first).json()
    assert len(messages["items"]) == 1 and messages["items"][0]["text"] == "Olá"
    assert call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", other).status_code == 404
    assert not any(item["phone"] == phone for item in call("GET", "/whatsapp/conversations", other).json())


def test_concurrent_provider_redelivery_is_idempotent():
    tenant = tenant_id()
    waiter = session(tenant)
    set_provider_state(tenant)
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    message_id = "incoming-" + uuid.uuid4().hex
    with ThreadPoolExecutor(max_workers=5) as pool:
        responses = list(pool.map(lambda _: provider_event(tenant, phone=phone, message_id=message_id), range(5)))
    assert all(response.status_code == 200 for response in responses)
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    assert conversation["unread"] == 1
    assert call("GET", f"/whatsapp/conversations/{conversation['id']}/messages", waiter).json()["total"] == 1


def test_new_customer_reply_status_and_provider_failure():
    tenant = tenant_id()
    waiter = session(tenant)
    set_provider_state(tenant)
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    assert provider_event(tenant, phone=phone).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    assert conversation["customer_id"] is None
    linked = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter, json={"name": "Nova pessoa"})
    assert linked.status_code == 200
    customer = call("GET", f"/customers/{linked.json()['customer_id']}", waiter).json()
    assert customer["phone"] == phone and customer["name"] == "Nova pessoa"
    sent = call("POST", f"/whatsapp/conversations/{conversation['id']}/messages", waiter,
                json={"text": "Recebemos sua mensagem"})
    assert sent.status_code == 201 and sent.json()["direction"] == "outbound"
    assert status_event(tenant, sent.json()["external_id"], "delivered").status_code == 200
    assert any(item["status"] == "delivered" for item in call(
        "GET", f"/whatsapp/conversations/{conversation['id']}/messages", waiter).json()["items"])
    failure = call("POST", f"/whatsapp/conversations/{conversation['id']}/messages", waiter, json={"text": "FAIL"})
    assert failure.status_code == 502


def test_order_from_conversation_uses_existing_order_and_kds_flow():
    tenant = tenant_id()
    waiter = session(tenant)
    kitchen = session(tenant, "kitchen")
    manager = session(tenant, "manager")
    set_provider_state(tenant)
    phone = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    assert provider_event(tenant, phone=phone).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    customer_id = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter, json={}).json()["customer_id"]
    assert call("POST", f"/whatsapp/conversations/{conversation['id']}/order-updates-consent", waiter,
                json={"allowed": True}).status_code == 200
    product = call("POST", "/products", manager, json={"name": "Lanche", "price": 12})
    order = call("POST", "/orders", waiter,
                 json={"customer_id": customer_id, "items": [{"product_id": product.json()["id"], "quantity": 1}]})
    assert order.status_code == 201 and order.json()["customer_id"] == customer_id
    oid = order.json()["id"]
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


def test_failed_provider_notification_does_not_block_order_and_consent_is_required():
    tenant = tenant_id()
    waiter, manager = session(tenant), session(tenant, "manager")
    set_provider_state(tenant)
    phone = "551199990000"
    assert provider_event(tenant, phone=phone).status_code == 200
    conversation = next(item for item in call("GET", "/whatsapp/conversations", waiter).json() if item["phone"] == phone)
    customer_id = call("POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter, json={}).json()["customer_id"]
    product = call("POST", "/products", manager, json={"name": "Teste falha externa", "price": 5}).json()

    no_consent = call("POST", "/orders", waiter,
                      json={"customer_id": customer_id, "items": [{"product_id": product["id"], "quantity": 1}]})
    assert no_consent.status_code == 201
    with MongoClient(os.environ["MONGO_URL"]) as client:
        for _ in range(30):
            record = client[os.environ["DB_NAME"]].wa_notifications.find_one({"order_id": no_consent.json()["id"]})
            if record and record["state"] != "pending":
                break
            time.sleep(0.1)
        assert record["state"] == "skipped_no_consent"

    assert call("POST", f"/whatsapp/conversations/{conversation['id']}/order-updates-consent", waiter,
                json={"allowed": True}).status_code == 200
    order = call("POST", "/orders", waiter,
                 json={"customer_id": customer_id, "items": [{"product_id": product["id"], "quantity": 1}]})
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
        assert len(records) == 4 and all(item["state"] == "failed" for item in records)


def test_auto_messages_are_tenant_scoped_and_disabled_status_is_not_sent():
    tenant_a, tenant_b = tenant_id(), tenant_id()
    manager_a, waiter_a = session(tenant_a, "manager"), session(tenant_a)
    manager_b, waiter_b = session(tenant_b, "manager"), session(tenant_b)
    set_provider_state(tenant_a)
    set_provider_state(tenant_b)

    config_a = call("GET", "/whatsapp/auto-messages", manager_a).json()
    config_b = call("GET", "/whatsapp/auto-messages", manager_b).json()
    config_a["received"]["message"] = "A: {{cliente}} recebeu {{pedido}} em {{restaurante}}"
    config_a["ready"]["enabled"] = False
    config_b["received"]["message"] = "B: {{cliente}} recebeu {{pedido}}"
    assert call("PUT", "/whatsapp/auto-messages", manager_a, json=config_a).status_code == 200
    assert call("PUT", "/whatsapp/auto-messages", manager_b, json=config_b).status_code == 200
    assert call("PUT", "/whatsapp/auto-messages", waiter_a, json=config_a).status_code == 403
    assert call("GET", "/whatsapp/auto-messages", manager_a).json()["received"]["message"].startswith("A:")
    assert call("GET", "/whatsapp/auto-messages", manager_b).json()["received"]["message"].startswith("B:")

    def create_order_from_conversation(tenant, waiter, manager, phone, customer_name):
        assert provider_event(tenant, phone=phone, name=customer_name).status_code == 200
        conversation = next(
            item for item in call("GET", "/whatsapp/conversations", waiter).json()
            if item["phone"] == phone
        )
        customer_id = call(
            "POST", f"/whatsapp/conversations/{conversation['id']}/customer", waiter,
            json={"name": customer_name},
        ).json()["customer_id"]
        assert call(
            "POST", f"/whatsapp/conversations/{conversation['id']}/order-updates-consent",
            waiter, json={"allowed": True},
        ).status_code == 200
        product = call("POST", "/products", manager, json={"name": "Produto " + customer_name, "price": 10}).json()
        order = call(
            "POST", "/orders", waiter,
            json={"customer_id": customer_id, "items": [{"product_id": product["id"], "quantity": 1}]},
        ).json()
        return conversation, order

    phone_a = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    phone_b = "5511" + f"{uuid.uuid4().int % 100000000:08d}"
    conversation_a, order_a = create_order_from_conversation(
        tenant_a, waiter_a, manager_a, phone_a, "Cliente A"
    )
    conversation_b, order_b = create_order_from_conversation(
        tenant_b, waiter_b, manager_b, phone_b, "Cliente B"
    )
    assert call("PATCH", f"/orders/{order_a['id']}/status", waiter_a,
                json={"status": "in_preparation"}).status_code == 200
    assert call("PATCH", f"/orders/{order_a['id']}/status", waiter_a,
                json={"status": "ready"}).status_code == 200

    messages_a = call(
        "GET", f"/whatsapp/conversations/{conversation_a['id']}/messages", waiter_a
    ).json()["items"]
    messages_b = call(
        "GET", f"/whatsapp/conversations/{conversation_b['id']}/messages", waiter_b
    ).json()["items"]
    outbound_a = [item["text"] for item in messages_a if item["direction"] == "outbound"]
    outbound_b = [item["text"] for item in messages_b if item["direction"] == "outbound"]
    assert any(text.startswith("A: Cliente A recebeu #") for text in outbound_a)
    assert any(text.startswith("B: Cliente B recebeu #") for text in outbound_b)
    assert len(outbound_a) == 2
    with MongoClient(os.environ["MONGO_URL"]) as client:
        skipped = client[os.environ["DB_NAME"]].wa_notifications.find_one({
            "restaurant_id": tenant_a, "order_id": order_a["id"],
            "kind": "ready", "state": "skipped_disabled",
        })
        assert skipped is not None


def test_provider_event_rejects_missing_or_invalid_signature():
    tenant = tenant_id()
    session(tenant)
    payload = {"event": "message.received", "restaurant_id": tenant, "external_id": "x",
               "phone": "5511999991111", "message_type": "text", "text": "oi"}
    assert call("POST", "/whatsapp/provider/events", json=payload).status_code == 403
    assert provider_event(tenant, secret="wrong-secret-that-is-long-enough").status_code == 403
