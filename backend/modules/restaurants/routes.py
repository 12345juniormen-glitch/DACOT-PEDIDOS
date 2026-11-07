"""Tenant-scoped restaurant details and settings."""
import base64
import binascii
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from core.db import get_db
from core.deps import Tenant, get_tenant, require_any_permission, require_permissions

router = APIRouter(prefix="/restaurant", tags=["restaurant"])
DEFAULT_RECEIPT_SETTINGS = {"preset": "classic", "logo_data_url": None}
MAX_LOGO_BYTES = 2 * 1024 * 1024


class ReceiptSettingsInput(BaseModel):
    preset: Literal["classic", "compact", "minimal"] = "classic"
    logo_data_url: str | None = Field(default=None, max_length=2_800_000)

    @field_validator("logo_data_url")
    @classmethod
    def validate_logo(cls, value: str | None) -> str | None:
        if value is None:
            return None
        match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})", value)
        if not match:
            raise ValueError("A logo deve ser uma imagem PNG, JPEG ou WebP válida")
        mime, encoded = match.groups()
        try:
            image = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("A imagem da logo está inválida") from exc
        if not image or len(image) > MAX_LOGO_BYTES:
            raise ValueError("A logo deve ter no máximo 2 MB")
        signatures = {
            "png": image.startswith(b"\x89PNG\r\n\x1a\n"),
            "jpeg": image.startswith(b"\xff\xd8\xff"),
            "webp": image.startswith(b"RIFF") and image[8:12] == b"WEBP",
        }
        if not signatures[mime]:
            raise ValueError("O conteúdo da imagem não corresponde ao formato declarado")
        return value


@router.get("/current")
async def get_current_restaurant(tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    # The common restaurant context only needs identity fields; avoid returning
    # the potentially large receipt logo/settings on every shell request.
    r = await db.restaurants.find_one(
        {"id": tenant.restaurant_id}, {"_id": 0, "receipt_settings": 0}
    )
    if not r:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado")
    return r


@router.get("/print-settings")
async def get_print_settings(
    tenant: Tenant = Depends(require_any_permission("orders.view", "users.manage")),
):
    restaurant = await get_db().restaurants.find_one(
        {"id": tenant.restaurant_id}, {"_id": 0, "id": 1, "receipt_settings": 1}
    )
    if not restaurant:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado")
    settings = restaurant.get("receipt_settings") or {}
    preset = settings.get("preset")
    if preset not in {"classic", "compact", "minimal"}:
        preset = DEFAULT_RECEIPT_SETTINGS["preset"]
    return {
        "preset": preset,
        "logo_data_url": settings.get("logo_data_url"),
    }


@router.put("/print-settings")
async def update_print_settings(
    payload: ReceiptSettingsInput,
    tenant: Tenant = Depends(require_permissions("users.manage")),
):
    result = await get_db().restaurants.update_one(
        {"id": tenant.restaurant_id},
        {"$set": {"receipt_settings": payload.model_dump()}},
    )
    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado")
    return payload.model_dump()
