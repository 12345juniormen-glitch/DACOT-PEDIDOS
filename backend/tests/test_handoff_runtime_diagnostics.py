"""Unit tests for the temporary, module-authenticated issuer diagnostic."""

import asyncio
import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response


BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
ROUTES = BACKEND / "modules" / "provisioning" / "routes.py"
SPEC = importlib.util.spec_from_file_location("handoff_runtime_diagnostics_routes", ROUTES)
routes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(routes)


def test_handoff_runtime_diagnostics_is_disabled_by_default(monkeypatch):
    monkeypatch.delenv("HANDOFF_RUNTIME_DIAGNOSTICS", raising=False)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.handoff_runtime_diagnostics(Response(), "valid-module-key"))
    assert error.value.status_code == 404


def test_handoff_runtime_diagnostics_requires_valid_module_key_and_returns_only_boolean(monkeypatch):
    monkeypatch.setenv("HANDOFF_RUNTIME_DIAGNOSTICS", "true")
    monkeypatch.setenv("HANDOFF_ISSUER", "dacot-hub")
    with patch.object(routes, "module_api_key", return_value="valid-module-key"):
        with pytest.raises(HTTPException) as missing:
            asyncio.run(routes.handoff_runtime_diagnostics(Response(), ""))
        assert missing.value.status_code == 401

        with pytest.raises(HTTPException) as unauthorized:
            asyncio.run(routes.handoff_runtime_diagnostics(Response(), "invalid-module-key"))
        assert unauthorized.value.status_code == 401

        response = Response()
        result = asyncio.run(routes.handoff_runtime_diagnostics(response, "valid-module-key"))
    assert result == {"issuer_matches_contract": True}
    assert response.headers["cache-control"] == "no-store"
    assert "dacot-hub" not in str(result)


def test_handoff_runtime_diagnostics_reports_mismatch_without_returning_raw_value(monkeypatch):
    monkeypatch.setenv("HANDOFF_RUNTIME_DIAGNOSTICS", "true")
    monkeypatch.setenv("HANDOFF_ISSUER", "unexpected-value")
    with patch.object(routes, "module_api_key", return_value="valid-module-key"):
        result = asyncio.run(routes.handoff_runtime_diagnostics(Response(), "valid-module-key"))
    assert result == {"issuer_matches_contract": False}
    assert "unexpected-value" not in str(result)
