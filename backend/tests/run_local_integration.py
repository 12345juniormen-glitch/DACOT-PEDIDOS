"""Run scoped backend integration tests against disposable loopback-only services.

Usage (from backend/):
    .venv/Scripts/python.exe tests/run_local_integration.py --mongod PATH_TO_MONGOD

All backend/test credentials and service endpoints are overridden with fresh
test values, even if a local .env exists. Mongo data and logs are temporary.
"""

import argparse
import hashlib
import hmac
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from pymongo import MongoClient
from pymongo.errors import PyMongoError


BACKEND = Path(__file__).resolve().parents[1]
TESTS = [
    "tests/backend_test.py::TestOrdersFilteredByCustomer",
    "tests/backend_test.py::TestKitchenStatusRollback",
    "tests/backend_test.py::TestOrdersStatsTodayIndicators",
    "tests/backend_test.py::TestOrdersTodayFilters",
    "tests/backend_test.py::TestRoleEscalation",
    "tests/backend_test.py::TestLocalAdminRegression",
    "tests/test_contact_import.py",
    "tests/test_p0_local.py",
    "tests/test_order_history_audit.py",
    "tests/test_whatsapp.py",
]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class LocalHub(BaseHTTPRequestHandler):
    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length", "0")))

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _provider_authorized(self, body):
        expected = "sha256=" + hmac.new(self.server.provider_secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, self.headers.get("X-Dacot-Provider-Signature", ""))

    def do_POST(self):
        body = self._body()
        parts = self.path.strip("/").split("/")
        if (len(parts) == 7 and parts[:3] == ["api", "public", "tenants"]
                and parts[4:] == ["modules", "orders", "access"]):
            if self.headers.get("X-Module-Key") != self.server.module_key:
                self.send_error(403)
                return
            tenant = parts[3]
            self._json(200, {"active": tenant != "0" * 24})
            return
        if self.path.startswith("/test/provider/"):
            if self.headers.get("X-Test-Control") != self.server.test_control:
                self.send_error(403)
                return
            tenant, state = self.path.removeprefix("/test/provider/").split("/", 1)
            self.server.provider_sessions[tenant] = {
                "state": state, "connected": state == "connected", "qr_data_url": None,
                "phone": "5511999990000" if state == "connected" else None,
            }
            self._json(200, self.server.provider_sessions[tenant])
            return
        if not self._provider_authorized(body):
            self.send_error(403)
            return
        if len(parts) != 3 or parts[0] != "sessions" or parts[2] not in {"connect", "messages"}:
            self.send_error(404)
            return
        tenant, action = parts[1], parts[2]
        try:
            payload = json.loads(body)
        except ValueError:
            self.send_error(400)
            return
        if action == "connect":
            state = {"state": "waiting_qr", "connected": False,
                     "qr_data_url": "data:image/png;base64,dGVzdA==", "phone": None}
            self.server.provider_sessions[tenant] = state
            self._json(200, state)
            return
        if not self.server.provider_sessions.get(tenant, {}).get("connected"):
            self.send_error(409)
            return
        if payload.get("text") == "FAIL" or str(payload.get("to", "")).endswith("0000"):
            self.send_error(500)
            return
        self._json(201, {"external_id": "baileys." + uuid.uuid4().hex})

    def do_GET(self):
        if self.path.startswith("/sessions/"):
            body = b""
            if not self._provider_authorized(body):
                self.send_error(403)
                return
            tenant = self.path.removeprefix("/sessions/")
            self._json(200, self.server.provider_sessions.get(tenant, {
                "state": "disconnected", "connected": False, "qr_data_url": None, "phone": None,
            }))
            return
        if self.headers.get("X-Module-Key") != self.server.module_key:
            self.send_error(403)
            return
        parts = self.path.split("/")
        if len(parts) != 8 or parts[:4] != ["", "api", "public", "tenants"] or parts[5:] != ["modules", "orders", "status"]:
            self.send_error(404)
            return
        tenant = parts[4]
        if tenant == "unknown-t1":
            self.send_error(404)
            return
        body = json.dumps({"active": tenant != "inactive-t1"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        body = self._body()
        if not self._provider_authorized(body) or not self.path.startswith("/sessions/"):
            self.send_error(403)
            return
        tenant = self.path.removeprefix("/sessions/")
        state = {"state": "disconnected", "connected": False, "qr_data_url": None, "phone": None}
        self.server.provider_sessions[tenant] = state
        self._json(200, state)

    def log_message(self, *_args):
        pass


def wait_ready(check, process, name):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f"{name} exited during startup (code {process.returncode})")
        try:
            check()
            return
        except (OSError, URLError, PyMongoError):
            time.sleep(0.2)
    raise RuntimeError(f"{name} did not become ready")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mongod", required=True, type=Path)
    parser.add_argument("--all", action="store_true", help="Run the full existing backend integration suite")
    parser.add_argument("--handoff-only", action="store_true", help="Run only concurrent handoff regression tests")
    parser.add_argument("--permissions-only", action="store_true", help="Run only auth/user permission regression tests")
    parser.add_argument("--whatsapp-only", action="store_true", help="Run only WhatsApp provider integration tests")
    parser.add_argument("--serial", action="store_true", help="Disable pytest-xdist for diagnosis of shared-fixture races")
    args = parser.parse_args()
    mongod = args.mongod.resolve(strict=True)
    if mongod.name.lower() != "mongod.exe":
        parser.error("--mongod must point to a mongod.exe binary")

    mongo_port, hub_port, api_port = free_port(), free_port(), free_port()
    test_id = secrets.token_hex(8)
    module_key = secrets.token_urlsafe(32)
    provider_secret = secrets.token_urlsafe(48)
    test_control = secrets.token_urlsafe(32)
    env = os.environ.copy()
    env.update({
        "MONGO_URL": f"mongodb://127.0.0.1:{mongo_port}/?directConnection=true",
        "DB_NAME": f"dacot_integration_{test_id}",
        "APP_ENV": "development",
        "JWT_SECRET": secrets.token_urlsafe(48),
        "HANDOFF_JWT_SECRET": secrets.token_urlsafe(48),
        "HANDOFF_ISSUER": "dacot-local-test",
        "HANDOFF_AUDIENCE": "dacot-local-test",
        "HANDOFF_VERSION": "1",
        "HANDOFF_MODULE_ID": "orders",
        "HUB_BASE_URL": f"http://127.0.0.1:{hub_port}",
        "MODULE_API_KEY": module_key,
        "ADMIN_EMAIL": f"admin-{test_id}@example.com",
        "ADMIN_PASSWORD": secrets.token_urlsafe(32),
        "DEFAULT_RESTAURANT_NAME": f"DACOT Integration {test_id}",
        "REACT_APP_BACKEND_URL": f"http://127.0.0.1:{api_port}",
        "DACOT_LOCAL_INTEGRATION": "1",
        "WHATSAPP_PROVIDER_URL": f"http://127.0.0.1:{hub_port}",
        "WHATSAPP_PROVIDER_SECRET": provider_secret,
        "WHATSAPP_TEST_CONTROL_SECRET": test_control,
        "SESSION_HOURS": "8",
        "JWT_EXPIRE_MINUTES": "720",
        "NO_PROXY": "127.0.0.1,localhost",
        "no_proxy": "127.0.0.1,localhost",
    })
    hub = ThreadingHTTPServer(("127.0.0.1", hub_port), LocalHub)
    hub.module_key = module_key
    hub.provider_secret = provider_secret
    hub.test_control = test_control
    hub.provider_sessions = {
        tenant: {"state": "connected", "connected": True, "qr_data_url": None, "phone": "5511999990000"}
        for tenant in ("wa-t1", "wa-t2")
    }
    hub_thread = threading.Thread(target=hub.serve_forever, daemon=True)
    hub_thread.start()

    with tempfile.TemporaryDirectory(prefix="dacot-integration-") as temp:
        data = Path(temp) / "mongo-data"
        data.mkdir()
        with (Path(temp) / "mongo.log").open("w") as mongo_log, (Path(temp) / "api.log").open("w") as api_log:
            mongo = subprocess.Popen(
                [str(mongod), "--bind_ip", "127.0.0.1", "--port", str(mongo_port), "--dbpath", str(data), "--quiet"],
                stdout=mongo_log, stderr=subprocess.STDOUT,
            )
            api = None
            result = None
            try:
                def mongo_ping():
                    with MongoClient(env["MONGO_URL"], serverSelectionTimeoutMS=300) as client:
                        client.admin.command("ping")

                wait_ready(mongo_ping, mongo, "MongoDB")
                api = subprocess.Popen(
                    [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(api_port)],
                    cwd=BACKEND, env=env, stdout=api_log, stderr=subprocess.STDOUT,
                )
                wait_ready(lambda: urlopen(f"http://127.0.0.1:{api_port}/api/health", timeout=1).read(), api, "API")
                print("Isolated MongoDB, local Hub/provider stub and API ready on 127.0.0.1", flush=True)
                selected = (["tests/backend_test.py", "tests/test_contact_import.py", "tests/test_p0_local.py", "tests/test_handoff_concurrency.py", "tests/test_order_history_audit.py", "tests/test_whatsapp.py"]
                            if args.all else ["tests/test_handoff_concurrency.py"] if args.handoff_only
                            else [
                                "tests/test_p0_local.py::test_custom_permissions_and_optional_password_change",
                                "tests/test_p0_local.py::test_custom_roles_are_tenant_scoped_and_safe_to_edit_or_delete",
                            ] if args.permissions_only
                            else ["tests/test_whatsapp.py"] if args.whatsapp_only else TESTS)
                workers = ["-n", "0"] if args.serial else []
                result = subprocess.run([sys.executable, "-m", "pytest", *selected, *workers, "-q", "-ra"], cwd=BACKEND, env=env)
                return result.returncode
            finally:
                if api is not None:
                    api.terminate()
                    try:
                        api.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        api.kill()
                        api.wait()
                mongo.terminate()
                try:
                    mongo.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    mongo.kill()
                    mongo.wait()
                hub.shutdown()
                hub.server_close()
                if result is not None and result.returncode != 0:
                    lines = (Path(temp) / "api.log").read_text(errors="replace").splitlines()
                    errors = [i for i, line in enumerate(lines) if line.startswith("Traceback (most recent call last):")]
                    if errors:
                        print("First API traceback:", flush=True)
                        print("\n".join(lines[errors[0]:errors[0] + 55]), flush=True)


if __name__ == "__main__":
    sys.exit(main())
