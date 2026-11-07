import base64
import asyncio

import pytest
from pydantic import ValidationError

from core.deps import Tenant
from modules.restaurants import routes


class FakeRestaurants:
    def __init__(self):
        self.documents = {
            "restaurant-a": {"id": "restaurant-a", "receipt_settings": {"preset": "compact", "logo_data_url": "a-logo"}},
            "restaurant-b": {"id": "restaurant-b", "receipt_settings": {"preset": "minimal", "logo_data_url": None}},
        }
        self.last_query = None
        self.last_update = None

    async def find_one(self, query, projection=None):
        self.last_query = query
        return self.documents.get(query["id"])

    async def update_one(self, query, update):
        self.last_query = query
        self.last_update = update
        doc = self.documents.get(query["id"])
        if not doc:
            return type("UpdateResult", (), {"matched_count": 0})()
        doc.update(update["$set"])
        return type("UpdateResult", (), {"matched_count": 1})()


class FakeDB:
    def __init__(self):
        self.restaurants = FakeRestaurants()


def tenant(restaurant_id):
    return Tenant({"id": "user-1", "restaurant_id": restaurant_id, "role": "admin", "permissions": ["users.manage"]})


def test_print_settings_are_scoped_to_authenticated_restaurant(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(routes, "get_db", lambda: db)

    async def run():
        settings_a = await routes.get_print_settings(tenant("restaurant-a"))
        assert settings_a == {"preset": "compact", "logo_data_url": "a-logo"}
        assert db.restaurants.last_query == {"id": "restaurant-a"}

        settings_b = await routes.get_print_settings(tenant("restaurant-b"))
        assert settings_b == {"preset": "minimal", "logo_data_url": None}
        assert db.restaurants.last_query == {"id": "restaurant-b"}
    asyncio.run(run())


def test_saving_print_settings_updates_only_current_restaurant(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(routes, "get_db", lambda: db)
    payload = routes.ReceiptSettingsInput(preset="classic", logo_data_url=None)

    async def run():
        result = await routes.update_print_settings(payload, tenant("restaurant-a"))
        assert result == {"preset": "classic", "logo_data_url": None}
        assert db.restaurants.last_query == {"id": "restaurant-a"}
        assert db.restaurants.documents["restaurant-a"]["receipt_settings"]["preset"] == "classic"
        assert db.restaurants.documents["restaurant-b"]["receipt_settings"]["preset"] == "minimal"
    asyncio.run(run())


def test_logo_accepts_small_png_data_url():
    png_header = b"\x89PNG\r\n\x1a\n"
    data_url = "data:image/png;base64," + base64.b64encode(png_header).decode("ascii")
    payload = routes.ReceiptSettingsInput(preset="compact", logo_data_url=data_url)
    assert payload.logo_data_url == data_url


def test_logo_accepts_image_larger_than_500_kb_up_to_2_mb():
    image = b"\x89PNG\r\n\x1a\n" + (b"x" * (600 * 1024 - 8))
    data_url = "data:image/png;base64," + base64.b64encode(image).decode("ascii")
    payload = routes.ReceiptSettingsInput(logo_data_url=data_url)
    assert payload.logo_data_url == data_url


def test_logo_rejects_image_larger_than_2_mb():
    image = b"\x89PNG\r\n\x1a\n" + (b"x" * (2 * 1024 * 1024 - 7))
    data_url = "data:image/png;base64," + base64.b64encode(image).decode("ascii")
    with pytest.raises(ValidationError):
        routes.ReceiptSettingsInput(logo_data_url=data_url)


@pytest.mark.parametrize("value", [
    "https://example.test/logo.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,VEhJUyBJUyBOT1QgUE5H",
])
def test_logo_rejects_external_unsupported_or_mismatched_image(value):
    with pytest.raises(ValidationError):
        routes.ReceiptSettingsInput(logo_data_url=value)
