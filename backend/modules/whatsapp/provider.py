"""Provider boundary for WhatsApp transport implementations.

The DACOT domain only speaks this small HTTP contract. Baileys runs in a
separate Node.js gateway and never exposes session credentials to this API or
to the browser.
"""
import hashlib
import hmac
import json
import os
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse


def _provider_url() -> str:
    value = os.environ.get("WHATSAPP_PROVIDER_URL", "").rstrip("/")
    if not value:
        raise HTTPException(503, "Provider do WhatsApp não configurado")
    return value


def _provider_secret() -> str:
    value = os.environ.get("WHATSAPP_PROVIDER_SECRET", "")
    if len(value) < 32:
        raise HTTPException(503, "Segredo do provider do WhatsApp não configurado")
    return value


def sign_payload(body: bytes) -> str:
    return "sha256=" + hmac.new(_provider_secret().encode(), body, hashlib.sha256).hexdigest()


def verify_provider_signature(body: bytes, signature: str | None) -> None:
    if not signature or not signature.startswith("sha256="):
        raise HTTPException(403, "Evento do provider não autenticado")
    if not hmac.compare_digest(sign_payload(body), signature):
        raise HTTPException(403, "Evento do provider não autenticado")


async def _request(method: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode() if payload is not None else b""
    headers = {"X-Dacot-Provider-Signature": sign_payload(body)}
    if body:
        headers["Content-Type"] = "application/json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.request(
                method,
                f"{_provider_url()}{path}",
                content=body or None,
                headers=headers,
            )
        if response.status_code == 404:
            raise HTTPException(404, "Sessão do WhatsApp não encontrada")
        if response.status_code == 409:
            raise HTTPException(409, "Sessão do WhatsApp em uso ou desconectada")
        response.raise_for_status()
        return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Falha de comunicação com o provider do WhatsApp")


async def connection_status(restaurant_id: str) -> dict:
    return await _request("GET", f"/sessions/{quote(restaurant_id, safe='')}")


async def connect(restaurant_id: str) -> dict:
    return await _request("POST", f"/sessions/{quote(restaurant_id, safe='')}/connect", {})


async def disconnect(restaurant_id: str) -> dict:
    return await _request("DELETE", f"/sessions/{quote(restaurant_id, safe='')}")


async def send_text(restaurant_id: str, phone: str, text: str) -> str:
    result = await _request(
        "POST", f"/sessions/{quote(restaurant_id, safe='')}/messages", {"to": phone, "text": text},
    )
    external_id = result.get("external_id")
    if not isinstance(external_id, str) or not external_id:
        raise HTTPException(502, "Resposta inválida do provider do WhatsApp")
    return external_id


async def media_stream(restaurant_id: str, external_id: str) -> StreamingResponse:
    path = f"/sessions/{quote(restaurant_id, safe='')}/media/{quote(external_id, safe='')}"
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    try:
        request = client.build_request("GET", f"{_provider_url()}{path}",
                                       headers={"X-Dacot-Provider-Signature": sign_payload(b"")})
        response = await client.send(request, stream=True)
        if response.status_code == 404:
            raise HTTPException(404, "Mídia não disponível")
        response.raise_for_status()
        mime_type = response.headers.get("content-type", "")
        allowed = {"image/jpeg", "image/png", "image/webp", "audio/ogg", "audio/mpeg",
                   "audio/mp4", "audio/aac", "audio/webm", "video/mp4", "video/webm",
                   "application/octet-stream"}
        if mime_type not in allowed:
            raise HTTPException(502, "Tipo de mídia inválido do provider")
    except HTTPException:
        await client.aclose()
        raise
    except (httpx.HTTPError, ValueError):
        await client.aclose()
        raise HTTPException(502, "Falha ao buscar mídia do WhatsApp")

    async def chunks():
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    disposition = "attachment" if mime_type == "application/octet-stream" else "inline"
    return StreamingResponse(chunks(), media_type=mime_type,
                             headers={"Cache-Control": "private, no-store",
                                      "Content-Disposition": disposition,
                                      "X-Content-Type-Options": "nosniff"})
