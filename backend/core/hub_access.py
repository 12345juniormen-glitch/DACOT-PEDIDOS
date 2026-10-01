"""Bounded positive leases for Hub identities; no stale authorization on failure."""
import asyncio
import os
import time
from collections import OrderedDict
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException


LEASE_SECONDS = 60
MAX_ENTRIES = 10000
_leases = OrderedDict()
# Fixed-size striped locks bound memory and coalesce requests for the same identity.
_locks = [asyncio.Lock() for _ in range(64)]


def validate_handoff_configuration():
    """Validate production integration settings without logging secret values."""
    if os.environ.get("APP_ENV", "production").strip().lower() != "production":
        return

    errors = []
    secret = os.environ.get("HANDOFF_JWT_SECRET", "")
    if len(secret) < 32:
        errors.append("HANDOFF_JWT_SECRET deve ter ao menos 32 caracteres")
    if secret and secret == os.environ.get("JWT_SECRET"):
        errors.append("HANDOFF_JWT_SECRET deve ser diferente de JWT_SECRET")
    for name in ("HANDOFF_ISSUER", "HANDOFF_AUDIENCE", "HANDOFF_VERSION", "HANDOFF_MODULE_ID"):
        if not os.environ.get(name, "").strip():
            errors.append(f"{name} é obrigatório")
    if os.environ.get("HANDOFF_VERSION") not in (None, "1"):
        errors.append("HANDOFF_VERSION deve ser 1")
    if os.environ.get("HANDOFF_MODULE_ID") not in (None, "orders"):
        errors.append("HANDOFF_MODULE_ID deve ser orders")

    values = {os.environ[n] for n in ("MODULE_API_KEY", "HUB_MODULE_KEY") if os.environ.get(n)}
    if len(values) != 1 or len(next(iter(values), "")) < 32:
        errors.append("MODULE_API_KEY deve ser única e ter ao menos 32 caracteres")

    base = os.environ.get("HUB_BASE_URL", "").rstrip("/")
    try:
        parsed = urlsplit(base)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or "\\" in base or "*" in base):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        errors.append("HUB_BASE_URL deve ser uma origem HTTPS exata, sem caminho")

    if os.environ.get("ENABLE_LOCAL_BOOTSTRAP", "").strip().lower() in {"1", "true", "yes", "on"}:
        errors.append("ENABLE_LOCAL_BOOTSTRAP não pode ser habilitado em produção")
    if errors:
        raise RuntimeError("Configuração Hub → Pedidos inválida: " + "; ".join(errors))


def validate_context(context):
    if (not isinstance(context, dict) or set(context) != {"user", "tenant", "module"}
            or any(type(v) is not int or v < 0 for v in context.values())):
        raise HTTPException(401, "Sessão Hub antiga ou inválida; entre novamente pelo portal")


def module_api_key():
    values = {os.environ[n] for n in ("MODULE_API_KEY", "HUB_MODULE_KEY") if os.environ.get(n)}
    if len(values) != 1:
        raise HTTPException(503, "Configure MODULE_API_KEY sem aliases conflitantes")
    return next(iter(values))


async def check_hub_access(restaurant_id, hub_user_id, role, context, *, fresh=False):
    validate_context(context)
    key = (restaurant_id, hub_user_id, role, context["user"], context["tenant"], context["module"])
    async with _locks[hash(key) % len(_locks)]:
        started = time.monotonic()
        if not fresh and _leases.get(key, 0) > started:
            _leases.move_to_end(key)
            return
        _leases.pop(key, None)
        base = os.environ.get("HUB_BASE_URL", "").rstrip("/")
        try:
            parsed = urlsplit(base)
            if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
                    or parsed.path not in ("", "/") or "\\" in base
                    or any(ord(c) <= 32 for c in base)):
                raise ValueError()
            if parsed.scheme != "https" and not (
                os.environ.get("APP_ENV") == "development" and parsed.scheme == "http"
                and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            ):
                raise ValueError()
            # IDs are path segments, never URLs or traversal.
            if not restaurant_id or not all(c in "0123456789abcdefABCDEF" for c in restaurant_id) or len(restaurant_id) != 24:
                raise ValueError()
            url = f"{base}/api/public/tenants/{restaurant_id}/modules/orders/access"
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
                result = await client.post(url, headers={"X-Module-Key": module_api_key()}, json={
                    "subject": f"tenant_user:{hub_user_id}", "role": role, "hub_access": context,
                })
            if result.status_code != 200:
                raise ValueError()
            active = result.json().get("active")
            if active is False:
                raise HTTPException(403, "Acesso revogado no Hub; entre novamente pelo portal")
            if active is not True or time.monotonic() >= started + LEASE_SECONDS:
                raise ValueError()
        except (httpx.HTTPError, ValueError, TypeError, AttributeError):
            raise HTTPException(503, "Não foi possível confirmar acesso no Hub; tente novamente")
        # Count from before the network call, so latency never extends the window.
        _leases[key] = started + LEASE_SECONDS
        while len(_leases) > MAX_ENTRIES:
            _leases.popitem(last=False)
