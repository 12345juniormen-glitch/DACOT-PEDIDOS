"""E2E validation — 10 scenarios covering full Hub → Pedidos integration."""
import time, uuid, sys, os
import requests
import jwt as pyjwt

API = "http://localhost:8001/api"
SECRET = "test-handoff-secret-32-bytes-long-string"
INACTIVE_FILE = "/tmp/mock_hub_inactive.txt"
results = []

def T(name, ok, det=""):
    results.append((name, ok, det))
    print(f"{'✅' if ok else '❌'} {name} — {det}")

def sign(rid, role="admin", sub=None, exp_offset=60, module="orders", iss="dacot-hub", aud="dacot-orders", ver=1, extra=None):
    now = int(time.time())
    claims = {
        "sub": f"tenant_user:{sub or 'hub-'+uuid.uuid4().hex[:8]}",
        "restaurant_id": rid, "role": role, "module": module,
        "iss": iss, "aud": aud, "iat": now, "nbf": now - 5,
        "exp": now + exp_offset, "jti": uuid.uuid4().hex, "handoff_version": ver,
    }
    if extra: claims.update(extra)
    return pyjwt.encode(claims, SECRET, algorithm="HS256")

def exchange(handoff):
    return requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=5)

def H(tok): return {"Authorization": f"Bearer {tok}"}

# =============================================================
# CLEANUP (não toca dados de produção)
# =============================================================
import pymongo
mc = pymongo.MongoClient("mongodb://localhost:27017")["dacot_db"]
test_tenants = ["e2e-A", "e2e-B", "e2e-toggle"]
for coll in ["orders","products","customers","users","restaurants"]:
    mc[coll].delete_many({"restaurant_id" if coll!="restaurants" else "id": {"$in": test_tenants}})
mc["handoff_jtis"].delete_many({})
open(INACTIVE_FILE, "w").write("")

# =============================================================
# TESTE 1 — 4 papéis diferentes recebem seu role no handoff
# =============================================================
print("\n### TESTE 1 — USUÁRIO DO RESTAURANTE (4 papéis) ###")
tokens = {}
for role in ["admin", "manager", "waiter", "kitchen"]:
    r = exchange(sign("e2e-A", role, sub=f"user-{role}"))
    T(f"1. handoff role={role} → sessão", r.status_code == 200, f"HTTP {r.status_code}")
    if r.status_code == 200:
        u = r.json()["user"]
        T(f"1. user.role={role}", u["role"] == role, f"got {u['role']}")
        T(f"1. user.restaurant_id=e2e-A", u["restaurant_id"] == "e2e-A", f"got {u['restaurant_id']}")
        tokens[role] = r.json()["token"]

# =============================================================
# TESTE 2 — validações do JWT (12 claims)
# =============================================================
print("\n### TESTE 2 — VALIDAÇÃO DO HANDOFF ###")
cases = [
    ("assinatura",   401, pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"e2e-A","role":"admin","module":"orders","iss":"dacot-hub","aud":"dacot-orders","iat":int(time.time()),"nbf":int(time.time()),"exp":int(time.time())+60,"jti":uuid.uuid4().hex,"handoff_version":1}, "wrong", algorithm="HS256")),
    ("issuer",       401, sign("e2e-A", iss="attacker")),
    ("audience",     401, sign("e2e-A", aud="other")),
    ("exp expirado", 401, sign("e2e-A", exp_offset=-30)),
    ("nbf futuro",   401, pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"e2e-A","role":"admin","module":"orders","iss":"dacot-hub","aud":"dacot-orders","iat":int(time.time()),"nbf":int(time.time())+3600,"exp":int(time.time())+7200,"jti":uuid.uuid4().hex,"handoff_version":1}, SECRET, algorithm="HS256")),
    ("module",       401, sign("e2e-A", module="billing")),
    ("role",         401, sign("e2e-A", role="superuser")),
    ("handoff_ver",  401, sign("e2e-A", ver=99)),
    ("sub ausente",  401, pyjwt.encode({"restaurant_id":"e2e-A","role":"admin","module":"orders","iss":"dacot-hub","aud":"dacot-orders","iat":int(time.time()),"nbf":int(time.time())-5,"exp":int(time.time())+60,"jti":uuid.uuid4().hex,"handoff_version":1}, SECRET, algorithm="HS256")),
    ("jti ausente",  401, pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"e2e-A","role":"admin","module":"orders","iss":"dacot-hub","aud":"dacot-orders","iat":int(time.time()),"nbf":int(time.time())-5,"exp":int(time.time())+60,"handoff_version":1}, SECRET, algorithm="HS256")),
    ("restaurant_id ausente", 401, sign("")),
]
for name, expected, h in cases:
    r = exchange(h)
    T(f"2. reject {name}", r.status_code == expected, f"HTTP {r.status_code}")

# =============================================================
# TESTE 3 — SESSION EXCHANGE (sessão local, TTL, handoff não vira sessão)
# =============================================================
print("\n### TESTE 3 — SESSION EXCHANGE ###")
h = sign("e2e-A", "admin")
r = exchange(h)
tok = r.json()["token"]
T("3. sessão local criada",           r.status_code == 200, f"HTTP {r.status_code}")
decoded = pyjwt.decode(tok, options={"verify_signature": False})
T("3. sessão tem restaurant_id correto", decoded["restaurant_id"] == "e2e-A", f"got {decoded['restaurant_id']}")
T("3. sessão tem role correto",       decoded["role"] == "admin", f"got {decoded['role']}")
ttl_hours = (decoded["exp"] - decoded["iat"]) / 3600
T("3. TTL ~8h",                       7.9 <= ttl_hours <= 8.1, f"{ttl_hours:.2f}h")
# handoff não pode ser usado como sessão Bearer
r_handoff_as_session = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {h}"})
T("3. handoff NÃO é sessão permanente", r_handoff_as_session.status_code == 401, f"HTTP {r_handoff_as_session.status_code}")

# =============================================================
# TESTE 4 — RBAC por papel (usa tokens do TESTE 1)
# =============================================================
print("\n### TESTE 4 — CADA PAPEL ###")
# Admin: acessa /users
r = requests.get(f"{API}/users", headers=H(tokens["admin"]))
T("4. admin GET /users",         r.status_code == 200, f"HTTP {r.status_code}")
# Manager: NÃO acessa /users, acessa /stats
r = requests.get(f"{API}/users", headers=H(tokens["manager"]))
T("4. manager GET /users → 403", r.status_code == 403, f"HTTP {r.status_code}")
r = requests.get(f"{API}/orders/stats", headers=H(tokens["manager"]))
T("4. manager GET /stats",       r.status_code == 200, f"HTTP {r.status_code}")
# Waiter: cria produto? NÃO. Cria pedido? SIM. Vê produtos? SIM.
r = requests.post(f"{API}/products", json={"name":"X","price":1,"category":"C","active":True}, headers=H(tokens["waiter"]))
T("4. waiter POST /products → 403", r.status_code == 403, f"HTTP {r.status_code}")
prod = requests.post(f"{API}/products", json={"name":"Prod","price":10,"category":"C","active":True}, headers=H(tokens["admin"])).json()
r = requests.post(f"{API}/orders", json={"items":[{"product_id":prod["id"],"quantity":1}]}, headers=H(tokens["waiter"]))
T("4. waiter POST /orders",         r.status_code == 201, f"HTTP {r.status_code}")
oid = r.json()["id"] if r.status_code == 201 else None
r = requests.get(f"{API}/products", headers=H(tokens["waiter"]))
T("4. waiter GET /products",        r.status_code == 200, f"HTTP {r.status_code}")
r = requests.get(f"{API}/orders/stats", headers=H(tokens["waiter"]))
T("4. waiter GET /stats → 403",     r.status_code == 403, f"HTTP {r.status_code}")
# Kitchen: pode alterar status new→in_prep e in_prep→ready, NÃO pode criar/cancelar
r = requests.patch(f"{API}/orders/{oid}/status", json={"status":"in_preparation"}, headers=H(tokens["kitchen"]))
T("4. kitchen new→in_preparation",  r.status_code == 200, f"HTTP {r.status_code}")
r = requests.patch(f"{API}/orders/{oid}/status", json={"status":"ready"}, headers=H(tokens["kitchen"]))
T("4. kitchen in_prep→ready",       r.status_code == 200, f"HTTP {r.status_code}")
r = requests.post(f"{API}/orders", json={"items":[{"product_id":prod["id"],"quantity":1}]}, headers=H(tokens["kitchen"]))
T("4. kitchen POST /orders → 403",  r.status_code == 403, f"HTTP {r.status_code}")
r = requests.post(f"{API}/orders/{oid}/cancel", headers=H(tokens["kitchen"]))
T("4. kitchen cancel → 403",        r.status_code == 403, f"HTTP {r.status_code}")

# =============================================================
# TESTE 5 — ISOLAMENTO (A vs B + injeções)
# =============================================================
print("\n### TESTE 5 — ISOLAMENTO ###")
tok_A = exchange(sign("e2e-A", "admin", sub="admin-A")).json()["token"]
tok_B = exchange(sign("e2e-B", "admin", sub="admin-B")).json()["token"]
me_A = requests.get(f"{API}/auth/me", headers=H(tok_A)).json()
me_B = requests.get(f"{API}/auth/me", headers=H(tok_B)).json()
T("5. me.A restaurant_id",  me_A["restaurant_id"] == "e2e-A", f"got {me_A['restaurant_id']}")
T("5. me.B restaurant_id",  me_B["restaurant_id"] == "e2e-B", f"got {me_B['restaurant_id']}")
# Semear em B
p_B = requests.post(f"{API}/products",  json={"name":"secretB","price":9,"category":"C","active":True}, headers=H(tok_B)).json()
c_B = requests.post(f"{API}/customers", json={"name":"cliB","phone":"1","notes":""}, headers=H(tok_B)).json()
o_B = requests.post(f"{API}/orders",    json={"items":[{"product_id":p_B["id"],"quantity":1}]}, headers=H(tok_B)).json()
# A tenta cross-tenant
T("5. A → GET pedido B → 404",   requests.get(f"{API}/orders/{o_B['id']}",   headers=H(tok_A)).status_code == 404)
T("5. A → GET produto B → 404",  requests.get(f"{API}/products/{p_B['id']}", headers=H(tok_A)).status_code == 404)
T("5. A → GET cliente B → 404",  requests.get(f"{API}/customers/{c_B['id']}",headers=H(tok_A)).status_code == 404)
T("5. A → PATCH pedido B → 404", requests.patch(f"{API}/orders/{o_B['id']}/status", json={"status":"in_preparation"}, headers=H(tok_A)).status_code == 404)
# Injections
r = requests.post(f"{API}/products", json={"name":"inj","price":1,"category":"C","active":True,"restaurant_id":"e2e-B"}, headers=H(tok_A)).json()
in_B = any(p["id"]==r["id"] for p in requests.get(f"{API}/products", headers=H(tok_B)).json())
T("5. body.restaurant_id ignorado",  not in_B, "produto foi criado em A, não B")
list_hj = requests.get(f"{API}/orders?restaurant_id=e2e-B", headers=H(tok_A)).json()
T("5. querystring restaurant_id ignorada", not any(o["id"]==o_B["id"] for o in list_hj), f"{len(list_hj)} pedidos")
r = requests.get(f"{API}/orders", headers={**H(tok_A), "X-Restaurant-Id":"e2e-B","X-Tenant-Id":"e2e-B"}).json()
T("5. X-Restaurant-Id/X-Tenant-Id ignorados", not any(o["id"]==o_B["id"] for o in r), f"{len(r)} pedidos")
# role no body no /orders
r = requests.post(f"{API}/orders", json={"items":[{"product_id":prod["id"],"quantity":1}],"role":"admin"}, headers=H(tok_A))
me_after = requests.get(f"{API}/auth/me", headers=H(tok_A)).json()
T("5. role no body ignorado (role continua admin do JWT)", me_after["role"] == "admin", f"got {me_after['role']}")

# =============================================================
# TESTE 6 — MÓDULO DESATIVADO (dynamic via mock_hub inactive file)
# =============================================================
print("\n### TESTE 6 — MÓDULO ATIVO/INATIVO ###")
r = exchange(sign("e2e-toggle", "admin", sub="tog"))
T("6. módulo ativo → 200", r.status_code == 200, f"HTTP {r.status_code}")
# desativar
open(INACTIVE_FILE, "w").write("e2e-toggle\n")
r = exchange(sign("e2e-toggle", "admin", sub="tog2"))
T("6. módulo INATIVO → 403", r.status_code == 403, f"HTTP {r.status_code} {r.json().get('detail','')}")
# reativar
open(INACTIVE_FILE, "w").write("")
r = exchange(sign("e2e-toggle", "admin", sub="tog3"))
T("6. módulo reativado → 200", r.status_code == 200, f"HTTP {r.status_code}")

# =============================================================
# TESTE 7 — ANTI-REPLAY
# =============================================================
print("\n### TESTE 7 — ANTI-REPLAY ###")
h = sign("e2e-A", "admin", sub="replay-test")
r1 = exchange(h)
r2 = exchange(h)
T("7. 1a utilização → 200", r1.status_code == 200)
T("7. 2a utilização → 401", r2.status_code == 401, f"HTTP {r2.status_code} {r2.json().get('detail','')}")

# =============================================================
# TESTE 8 — EXPIRAÇÃO
# =============================================================
print("\n### TESTE 8 — EXPIRAÇÃO ###")
r = exchange(sign("e2e-A", "admin", exp_offset=-60))
T("8. expired → 401", r.status_code == 401, f"HTTP {r.status_code} {r.json().get('detail','')}")

# =============================================================
# TESTE 9 — LOGIN NORMAL (regressão)
# =============================================================
print("\n### TESTE 9 — LOGIN NORMAL ###")
r = requests.post(f"{API}/auth/login", json={"email":"admin@dacot.app","password":"admin123"})
T("9. login → 200",  r.status_code == 200)
tok_local = r.json()["token"]
r = requests.get(f"{API}/auth/me", headers=H(tok_local))
T("9. me → 200",     r.status_code == 200 and r.json()["email"] == "admin@dacot.app", f"HTTP {r.status_code}")
# TTL do local ≈ 12h
d = pyjwt.decode(tok_local, options={"verify_signature": False})
ttl_local = (d["exp"] - d["iat"]) / 3600
T("9. local session TTL ≈ 12h (não vazou 8h do handoff)", 11.9 <= ttl_local <= 12.1, f"{ttl_local:.2f}h")
r = requests.post(f"{API}/auth/logout", headers=H(tok_local))
T("9. logout → 200", r.status_code == 200)

# =============================================================
# SUMÁRIO
# =============================================================
failed = [r for r in results if not r[1]]
print(f"\n>>> {len(results)-len(failed)}/{len(results)} testes passaram")
if failed:
    print("\nFALHAS:")
    for name, ok, det in failed: print(f"  ❌ {name} — {det}")
    sys.exit(1)

# CLEANUP
for coll in ["orders","products","customers","users","restaurants"]:
    mc[coll].delete_many({"restaurant_id" if coll!="restaurants" else "id": {"$in": test_tenants}})
mc["handoff_jtis"].delete_many({})
print("cleanup OK")
