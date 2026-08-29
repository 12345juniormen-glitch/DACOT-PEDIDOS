"""Ad-hoc security posture checks (bcrypt format, brute-force, CORS)."""
import asyncio
import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

be = dotenv_values("/app/backend/.env")
fe = dotenv_values("/app/frontend/.env")
API = fe["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


async def check_hash():
    c = AsyncIOMotorClient(be["MONGO_URL"])
    db = c[be["DB_NAME"]]
    u = await db.users.find_one({"email": be["ADMIN_EMAIL"].lower()})
    print("admin hash prefix:", u["password_hash"][:7], "len", len(u["password_hash"]))
    hu = await db.users.find_one({"provisioned_by": "hub_handoff"})
    print("handoff user password_hash repr:", repr(hu.get("password_hash")))
    print("handoff jti count:", await db.handoff_jtis.count_documents({}))


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
    asyncio.run(check_hash())
    check_bruteforce()
    check_cors()
