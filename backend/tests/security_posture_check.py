"""Ad-hoc security posture checks (bcrypt format, brute-force, CORS)."""
import asyncio
import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

be = dotenv_values("/app/backend/.env")
fe = dotenv_values("/app/frontend/.env")
API = fe.get("REACT_APP_BACKEND_URL", "").rstrip("/") + "/api"


def format_credential_status(admin_exists: bool, handoff_user_exists: bool) -> str:
    return (
        "Credential records: "
        f"admin={'present' if admin_exists else 'missing'}, "
        f"handoff_user={'present' if handoff_user_exists else 'missing'}"
    )


async def check_credential_records(db=None, admin_email: str | None = None):
    client = None
    if db is None:
        client = AsyncIOMotorClient(be["MONGO_URL"])
        db = client[be["DB_NAME"]]
    if admin_email is None:
        admin_email = be["ADMIN_EMAIL"].lower()
    admin = await db.users.find_one({"email": admin_email}, {"_id": 1})
    handoff_user = await db.users.find_one(
        {"provisioned_by": "hub_handoff"}, {"_id": 1}
    )
    print(format_credential_status(bool(admin), bool(handoff_user)))
    print("handoff jti count:", await db.handoff_jtis.count_documents({}))
    if client is not None:
        client.close()


def check_bruteforce():
    codes = []
    for _ in range(7):
        r = requests.post(f"{API}/auth/login", json={"email": be["ADMIN_EMAIL"], "password": "wrong-pass"}, timeout=20)
        codes.append(r.status_code)
    print("brute force codes:", codes)
    ok = requests.post(f"{API}/auth/login", json={"email": be["ADMIN_EMAIL"], "password": be["ADMIN_PASSWORD"]}, timeout=20)
    print("valid login after 7 fails:", ok.status_code)


def check_cors():
    r = requests.options(f"{API}/auth/login", headers={
        "Origin": "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    }, timeout=20)
    print("preflight:", r.status_code, {k: v for k, v in r.headers.items() if k.lower().startswith("access-control")})


if __name__ == "__main__":
    asyncio.run(check_credential_records())
    check_bruteforce()
    check_cors()
