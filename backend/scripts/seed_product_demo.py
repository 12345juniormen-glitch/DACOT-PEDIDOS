"""Populate an isolated local tenant used for DACOT product screenshots.

Usage (from ``backend``):
    python scripts/seed_product_demo.py \
      --mongo-url mongodb://127.0.0.1:27018 \
      --db-name dacot_product_demo \
      --admin-password "a-local-disposable-password" \
      --replace

The safety checks intentionally reject remote hosts and database names that do
not clearly identify a demo/test database.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from motor.motor_asyncio import AsyncIOMotorClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from core.permissions import permissions_for_role  # noqa: E402
from core.security import hash_password  # noqa: E402


RESTAURANT_ID = "demo-brasa-do-centro"
ADMIN_EMAIL = "demo.pedidos@dacot.com.br"


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def validate_target(mongo_url: str, db_name: str) -> None:
    parsed = urlparse(mongo_url)
    if parsed.scheme not in {"mongodb", "mongodb+srv"}:
        raise SystemExit("A URL precisa usar mongodb://")
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("O seed demo aceita somente MongoDB local/loopback")
    if not re.search(r"(?:demo|test)", db_name, re.IGNORECASE):
        raise SystemExit("O nome do banco precisa conter 'demo' ou 'test'")


def product(product_id: str, name: str, category: str, cents: int, prep: int, description: str, now: str) -> dict:
    return {
        "id": product_id,
        "restaurant_id": RESTAURANT_ID,
        "name": name,
        "description": description,
        "price_cents": cents,
        "category": category,
        "prep_time_seconds": prep,
        "active": True,
        "created_at": now,
        "updated_at": now,
    }


def order_event(order_id: str, event_id: str, kind: str, previous: str | None, current: str, at: datetime) -> dict:
    return {
        "id": event_id,
        "restaurant_id": RESTAURANT_ID,
        "order_id": order_id,
        "type": kind,
        "previous_status": previous,
        "new_status": current,
        "user_id": "demo-user-admin",
        "occurred_at": iso(at),
    }


def build_order(spec: dict, products: dict[str, dict], customers: dict[str, dict], now: datetime) -> dict:
    order_id = f"demo-order-{spec['number']}"
    created = now - timedelta(minutes=spec["age"])
    customer = customers[spec["customer"]]
    items = []
    for product_id, quantity, notes in spec["items"]:
        item = products[product_id]
        items.append({
            "product_id": item["id"],
            "product_name": item["name"],
            "unit_price_cents": item["price_cents"],
            "prep_time_seconds": item["prep_time_seconds"],
            "quantity": quantity,
            "notes": notes,
        })
    subtotal = sum(item["unit_price_cents"] * item["quantity"] for item in items)
    discount = spec.get("discount", 0)
    events = [order_event(order_id, f"{order_id}-created", "created", None, "new", created)]
    updated = created
    if spec["status"] in {"in_preparation", "ready", "delivered"}:
        updated = created + timedelta(minutes=min(4, max(1, spec["age"] // 3)))
        events.append(order_event(order_id, f"{order_id}-prep", "status_changed", "new", "in_preparation", updated))
    if spec["status"] in {"ready", "delivered"}:
        updated = created + timedelta(minutes=min(spec["age"] - 2, max(8, spec["age"] // 2)))
        events.append(order_event(order_id, f"{order_id}-ready", "status_changed", "in_preparation", "ready", updated))
    delivered_at = None
    cancelled_at = None
    if spec["status"] == "delivered":
        updated = created + timedelta(minutes=min(spec["age"] - 1, max(14, int(spec["age"] * 0.72))))
        delivered_at = iso(updated)
        events.append(order_event(order_id, f"{order_id}-delivered", "status_changed", "ready", "delivered", updated))
    elif spec["status"] == "cancelled":
        updated = created + timedelta(minutes=min(7, spec["age"] - 1))
        cancelled_at = iso(updated)
        events.append(order_event(order_id, f"{order_id}-cancelled", "status_changed", "new", "cancelled", updated))
    return {
        "id": order_id,
        "restaurant_id": RESTAURANT_ID,
        "order_number": spec["number"],
        "customer_id": customer["id"],
        "customer_name": customer["name"],
        "items": items,
        "notes": spec["notes"],
        "subtotal_cents": subtotal,
        "discount_type": "fixed" if discount else "none",
        "discount_value": discount / 100,
        "discount_cents": discount,
        "total_cents": subtotal - discount,
        "status": spec["status"],
        "service_type": spec["service"],
        "payment_method": spec["payment"],
        "created_at": iso(created),
        "updated_at": iso(updated),
        "delivered_at": delivered_at,
        "cancelled_at": cancelled_at,
        "created_by": "demo-user-admin",
        "events": events,
    }


async def seed(args: argparse.Namespace) -> None:
    validate_target(args.mongo_url, args.db_name)
    if not args.replace:
        raise SystemExit("Use --replace para confirmar a recriação do tenant demo")

    client = AsyncIOMotorClient(args.mongo_url, serverSelectionTimeoutMS=5000)
    await client.admin.command("ping")
    db = client[args.db_name]
    now = datetime.now(timezone.utc).replace(microsecond=0)
    now_iso = iso(now)

    scoped_collections = [
        "products", "customers", "orders", "users", "custom_roles",
        "wa_conversations", "wa_messages", "wa_auto_messages", "wa_notifications",
    ]
    for collection in scoped_collections:
        await db[collection].delete_many({"restaurant_id": RESTAURANT_ID})
    await db.restaurants.delete_many({"id": RESTAURANT_ID})
    await db.order_counters.delete_many({"_id": RESTAURANT_ID})

    await db.restaurants.insert_one({
        "id": RESTAURANT_ID,
        "name": "Brasa do Centro",
        "slug": "brasa-do-centro",
        "created_at": now_iso,
    })

    users = [
        ("demo-user-admin", "Marina Costa", ADMIN_EMAIL, "admin"),
        ("demo-user-manager", "Eduardo Ramos", "gerente.demo@dacot.com.br", "manager"),
        ("demo-user-waiter", "Camila Nunes", "atendimento.demo@dacot.com.br", "waiter"),
        ("demo-user-kitchen", "Paulo Mendes", "cozinha.demo@dacot.com.br", "kitchen"),
    ]
    await db.users.insert_many([{
        "id": user_id,
        "restaurant_id": RESTAURANT_ID,
        "email": email,
        "password_hash": hash_password(args.admin_password),
        "name": name,
        "role": role,
        "permissions": permissions_for_role(role),
        "active": True,
        "must_change_password": False,
        "created_at": now_iso,
        "updated_at": now_iso,
    } for user_id, name, email, role in users])

    product_rows = [
        ("xburger", "X-Burger Artesanal", "Lanches", 2890, 720, "Pão brioche, carne artesanal, queijo e molho da casa."),
        ("xsalada", "X-Salada", "Lanches", 2690, 600, "Hambúrguer, queijo, alface, tomate e maionese da casa."),
        ("batata", "Batata Rústica", "Porções", 1800, 480, "Batatas rústicas crocantes com páprica e alecrim."),
        ("picanha", "Picanha na Brasa", "Pratos", 6400, 1320, "Picanha grelhada, arroz, farofa e vinagrete."),
        ("parmegiana", "Parmegiana de Frango", "Pratos", 3990, 1320, "Filé de frango empanado, molho artesanal e queijo gratinado."),
        ("frango", "Frango Grelhado", "Pratos", 3290, 1080, "Filé grelhado com arroz, feijão e salada fresca."),
        ("marmita", "Marmita Executiva", "Pratos", 2490, 900, "Prato executivo do dia com acompanhamentos."),
        ("coca", "Coca-Cola Lata", "Bebidas", 600, 0, "Lata 350 ml gelada."),
        ("suco", "Suco de Laranja", "Bebidas", 850, 180, "Suco natural preparado na hora."),
        ("pudim", "Pudim da Casa", "Sobremesas", 990, 0, "Pudim cremoso com calda de caramelo."),
        ("brownie", "Brownie com Sorvete", "Sobremesas", 1490, 240, "Brownie aquecido com sorvete de creme."),
    ]
    product_docs = [product(f"demo-product-{key}", name, category, cents, prep, description, now_iso)
                    for key, name, category, cents, prep, description in product_rows]
    await db.products.insert_many(product_docs)
    products = {doc["id"].removeprefix("demo-product-"): doc for doc in product_docs}

    customer_rows = [
        ("mariana", "Mariana Souza", "11987654321", "Prefere contato por WhatsApp."),
        ("carlos", "Carlos Lima", "11976543210", "Retira no balcão."),
        ("ana", "Ana Paula", "11965432109", "Apartamento 42."),
        ("joao", "João Ferreira", "11954321098", "Cliente frequente do almoço."),
        ("felipe", "Felipe Santos", "11943210987", "Sem observações."),
        ("beatriz", "Beatriz Martins", "11932109876", "Entrega na portaria."),
        ("rafael", "Rafael Oliveira", "11921098765", "Prefere pagamento via Pix."),
        ("lucas", "Lucas Almeida", "11910987654", "Retirada rápida."),
    ]
    customer_docs = [{
        "id": f"demo-customer-{key}", "restaurant_id": RESTAURANT_ID,
        "name": name, "phone": phone, "normalized_phone": phone, "notes": notes,
        "created_at": iso(now - timedelta(days=30 - index * 2)), "updated_at": now_iso,
    } for index, (key, name, phone, notes) in enumerate(customer_rows)]
    await db.customers.insert_many(customer_docs)
    customers = {doc["id"].removeprefix("demo-customer-"): doc for doc in customer_docs}

    specs = [
        {"number": 4811, "customer": "mariana", "status": "new", "age": 3, "service": "delivery", "payment": "Pix", "notes": "Entregar na portaria. Interfone 24.", "items": [("xburger", 2, "Um sem cebola"), ("batata", 1, ""), ("coca", 2, "")]},
        {"number": 4812, "customer": "carlos", "status": "new", "age": 7, "service": "balcao", "payment": "Cartão", "notes": "Retirada no balcão.", "items": [("marmita", 2, "Caprichar na salada"), ("suco", 1, "Sem açúcar")]},
        {"number": 4813, "customer": "ana", "status": "in_preparation", "age": 12, "service": "delivery", "payment": "Dinheiro", "notes": "Troco para R$ 100,00.", "items": [("parmegiana", 1, "Sem ervilha"), ("coca", 1, "")]},
        {"number": 4814, "customer": "joao", "status": "in_preparation", "age": 19, "service": "salao", "payment": "Cartão", "notes": "Mesa 7. Molho à parte.", "items": [("picanha", 1, "Ao ponto"), ("batata", 1, ""), ("suco", 2, "Pouco gelo")]},
        {"number": 4815, "customer": "felipe", "status": "in_preparation", "age": 26, "service": "delivery", "payment": "Pix", "notes": "Portão preto ao lado da farmácia.", "items": [("xsalada", 3, "Um sem tomate"), ("batata", 2, ""), ("coca", 3, "")]},
        {"number": 4816, "customer": "beatriz", "status": "ready", "age": 18, "service": "balcao", "payment": "Pix", "notes": "Cliente aguardando no balcão.", "items": [("frango", 1, "Sem feijão"), ("pudim", 1, "")]},
        {"number": 4817, "customer": "rafael", "status": "ready", "age": 24, "service": "salao", "payment": "Cartão", "notes": "Mesa 12.", "items": [("xburger", 1, "Carne bem passada"), ("suco", 1, ""), ("brownie", 1, "Servir após o lanche")]},
        {"number": 4818, "customer": "lucas", "status": "delivered", "age": 48, "service": "balcao", "payment": "Pix", "notes": "Retirado pelo cliente.", "items": [("marmita", 1, ""), ("coca", 1, "")]},
        {"number": 4819, "customer": "mariana", "status": "delivered", "age": 82, "service": "delivery", "payment": "Cartão", "notes": "Entrega confirmada na portaria.", "items": [("picanha", 2, "Ao ponto"), ("batata", 1, ""), ("pudim", 2, "")]},
        {"number": 4820, "customer": "ana", "status": "cancelled", "age": 95, "service": "delivery", "payment": "Pix", "notes": "Cancelado a pedido da cliente.", "items": [("xsalada", 1, "Sem maionese"), ("coca", 1, "")]},
        {"number": 4821, "customer": "joao", "status": "delivered", "age": 135, "service": "salao", "payment": "Cartão", "notes": "Mesa 4.", "discount": 500, "items": [("parmegiana", 2, ""), ("suco", 2, ""), ("brownie", 1, "")]},
        {"number": 4822, "customer": "beatriz", "status": "delivered", "age": 190, "service": "delivery", "payment": "Dinheiro", "notes": "Entregue sem intercorrências.", "items": [("frango", 2, ""), ("pudim", 2, "")]},
        {"number": 4823, "customer": "carlos", "status": "new", "age": 1, "service": "balcao", "payment": "Pix", "notes": "Embalar para viagem.", "items": [("xburger", 1, "Sem picles"), ("coca", 1, "")]},
        {"number": 4824, "customer": "rafael", "status": "ready", "age": 15, "service": "delivery", "payment": "Pix", "notes": "Motoboy aguardando.", "items": [("marmita", 3, "Uma sem feijão"), ("suco", 2, "")]} ,
    ]
    order_docs = [build_order(spec, products, customers, now) for spec in specs]
    await db.orders.insert_many(order_docs)
    await db.order_counters.insert_one({"_id": RESTAURANT_ID, "sequence": 4824})

    conversation_specs = [
        ("mariana", "Mariana Souza", 2), ("carlos", "Carlos Lima", 0),
        ("beatriz", "Beatriz Martins", 1), ("rafael", "Rafael Oliveira", 0),
        ("ana", "Ana Paula", 0),
    ]
    conversations, messages = [], []
    chat_lines = {
        "mariana": [("inbound", "Boa noite! Quero dois X-Burgers e uma batata."), ("outbound", "Boa noite, Mariana! Já registrei seu pedido #4811."), ("inbound", "Perfeito, um dos lanches sem cebola, por favor.")],
        "carlos": [("inbound", "Meu pedido para retirada já está confirmado?"), ("outbound", "Sim, Carlos. O pedido #4812 já entrou na operação.")],
        "beatriz": [("inbound", "Oi! Meu frango grelhado já ficou pronto?"), ("outbound", "Ficou pronto agora, Beatriz. Pode retirar no balcão.")],
        "rafael": [("inbound", "Pode mandar a chave Pix?"), ("outbound", "Claro! O pagamento do pedido #4817 pode ser feito na retirada.")],
        "ana": [("inbound", "Obrigada pelo atendimento de hoje!"), ("outbound", "Nós que agradecemos, Ana. Até a próxima!")],
    }
    for index, (key, profile_name, unread) in enumerate(conversation_specs):
        customer = customers[key]
        conversation_id = f"demo-conversation-{key}"
        base = now - timedelta(minutes=6 + index * 13)
        conversations.append({
            "id": conversation_id, "restaurant_id": RESTAURANT_ID,
            "phone": customer["phone"], "profile_name": profile_name,
            "customer_id": customer["id"], "unread": unread,
            "order_updates_opt_in": True, "created_at": iso(base - timedelta(days=4)),
            "last_inbound_at": iso(base), "last_message_at": iso(base),
        })
        for msg_index, (direction, text) in enumerate(chat_lines[key]):
            at = base - timedelta(minutes=(len(chat_lines[key]) - msg_index) * 2)
            messages.append({
                "id": f"demo-message-{key}-{msg_index}", "restaurant_id": RESTAURANT_ID,
                "conversation_id": conversation_id, "direction": direction,
                "external_id": f"demo-external-{key}-{msg_index}", "type": "text",
                "text": text, "status": "read" if direction == "outbound" else "received",
                "created_at": iso(at), "user_id": "demo-user-admin" if direction == "outbound" else None,
            })
    await db.wa_conversations.insert_many(conversations)
    await db.wa_messages.insert_many(messages)

    print(f"Tenant demo criado: {RESTAURANT_ID}")
    print(f"Login: {ADMIN_EMAIL}")
    print(f"Produtos: {len(product_docs)} | Clientes: {len(customer_docs)} | Pedidos: {len(order_docs)}")
    client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed local isolado para screenshots do DACOT Pedidos")
    parser.add_argument("--mongo-url", required=True)
    parser.add_argument("--db-name", required=True)
    parser.add_argument("--admin-password", required=True)
    parser.add_argument("--replace", action="store_true")
    asyncio.run(seed(parser.parse_args()))


if __name__ == "__main__":
    main()
