"""Unit tests for the tenant-scoped structured customer import."""
import asyncio

from modules.customers import routes
from modules.customers.routes import ContactImportInput, import_contacts


class FakeCustomers:
    def __init__(self):
        self.docs = []

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return doc.copy()
        return None

    async def insert_one(self, doc):
        self.docs.append(doc.copy())


class FakeDb:
    def __init__(self):
        self.customers = FakeCustomers()


class Tenant:
    def __init__(self, restaurant_id):
        self.restaurant_id = restaurant_id


def test_import_deduplicates_normalized_phone_within_the_tenant(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(routes, "get_db", lambda: db)
    payload = ContactImportInput(contacts=[
        {"name": "Ana", "phone": "+55 (11) 99999-0000"},
        {"name": "Ana duplicada", "phone": "5511999990000"},
        {"name": "Inválido", "phone": "123"},
    ])

    result = asyncio.run(import_contacts(payload, Tenant("restaurante-a")))

    assert result.created == 1
    assert result.already_exists == 1
    assert result.invalid == 1
    assert db.customers.docs[0]["restaurant_id"] == "restaurante-a"
    assert db.customers.docs[0]["normalized_phone"] == "5511999990000"


def test_import_never_deduplicates_contacts_across_restaurants(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(routes, "get_db", lambda: db)
    payload = ContactImportInput(contacts=[{"name": "Ana", "phone": "5511999990000"}])

    first = asyncio.run(import_contacts(payload, Tenant("restaurante-a")))
    second = asyncio.run(import_contacts(payload, Tenant("restaurante-b")))

    assert first.created == second.created == 1
    assert {doc["restaurant_id"] for doc in db.customers.docs} == {"restaurante-a", "restaurante-b"}
