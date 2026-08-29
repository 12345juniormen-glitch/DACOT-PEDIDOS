"""Cross-tenant isolation — explicit security test.

Prova que um handoff LEGÍTIMO e ASSINADO pelo Hub para tenant-alpha
não pode ser usado para acessar dados de tenant-beta, nem
manipular restaurant_id/role via body/querystring/URL/frontend.
"""
import time, uuid, json, sys
import requests
import jwt as pyjwt

API = "http://localhost:8001/api"
SECRET = "test-handoff-secret-32-bytes-long-string"

def sign_handoff(restaurant_id, role="admin", sub_id=None):
    now = int(time.time())
    return pyjwt.encode({
        "sub": f"tenant_user:{sub_id or 'hub-'+uuid.uuid4().hex[:8]}",
        "restaurant_id": restaurant_id,
        "role": role,
        "module": "orders",
        "iss": "dacot-hub",
        "aud": "dacot-orders",
        "iat": now, "nbf": now - 5, "exp": now + 60,
        "jti": uuid.uuid4().hex,
        "handoff_version": 1,
    }, SECRET, algorithm="HS256")

def exchange(handoff):
    r = requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=5)
    r.raise_for_status()
    return r.json()

results = []
def T(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'✅' if ok else '❌'} {name} — {detail}")

# ---------- SETUP ----------
# Legítimo A: handoff para tenant-alpha, papel admin
sess_a = exchange(sign_handoff("tenant-alpha", "admin"))
tok_a = sess_a["token"]
user_a = sess_a["user"]

# Legítimo B: handoff para tenant-beta, papel admin. Popular com dados privados.
sess_b = exchange(sign_handoff("tenant-beta", "admin"))
tok_b = sess_b["token"]

H_A = {"Authorization": f"Bearer {tok_a}"}
H_B = {"Authorization": f"Bearer {tok_b}"}

# Semear em tenant-beta um produto, cliente e pedido
prod_b = requests.post(f"{API}/products", json={"name":"Segredo B","price":42,"category":"C","active":True}, headers=H_B).json()
cust_b = requests.post(f"{API}/customers", json={"name":"Cliente B","phone":"1","notes":""}, headers=H_B).json()
ord_b  = requests.post(f"{API}/orders",   json={"items":[{"product_id":prod_b["id"],"quantity":1}]}, headers=H_B).json()

# ---------- 1. Sessão contém restaurant_id=alpha (do JWT) ----------
T("1. sessão A tem restaurant_id=alpha", user_a["restaurant_id"] == "tenant-alpha", f"restaurant_id={user_a['restaurant_id']!r}")
me_a = requests.get(f"{API}/auth/me", headers=H_A).json()
T("1b. /auth/me confirma alpha",     me_a["restaurant_id"] == "tenant-alpha", f"me.restaurant_id={me_a['restaurant_id']!r}")

# ---------- 2. Usuário A NÃO acessa dados de B ----------
# 2a. GET pedido específico de B
r = requests.get(f"{API}/orders/{ord_b['id']}", headers=H_A)
T("2a. A → GET pedido B",   r.status_code == 404, f"HTTP {r.status_code}")
# 2b. GET produto específico de B
r = requests.get(f"{API}/products/{prod_b['id']}", headers=H_A)
T("2b. A → GET produto B",  r.status_code == 404, f"HTTP {r.status_code}")
# 2c. GET cliente específico de B
r = requests.get(f"{API}/customers/{cust_b['id']}", headers=H_A)
T("2c. A → GET cliente B",  r.status_code == 404, f"HTTP {r.status_code}")
# 2d. listagens de A não incluem itens de B
lst_ord  = requests.get(f"{API}/orders",    headers=H_A).json()
lst_prod = requests.get(f"{API}/products",  headers=H_A).json()
lst_cust = requests.get(f"{API}/customers", headers=H_A).json()
T("2d. listagem pedidos de A não vaza B",   not any(o["id"]==ord_b["id"] for o in lst_ord),   f"{len(lst_ord)} pedidos")
T("2e. listagem produtos de A não vaza B",  not any(p["id"]==prod_b["id"] for p in lst_prod), f"{len(lst_prod)} produtos")
T("2f. listagem clientes de A não vaza B",  not any(c["id"]==cust_b["id"] for c in lst_cust), f"{len(lst_cust)} clientes")
# 2g. PATCH em pedido de B
r = requests.patch(f"{API}/orders/{ord_b['id']}/status", json={"status":"in_preparation"}, headers=H_A)
T("2g. A → PATCH status pedido B",  r.status_code == 404, f"HTTP {r.status_code}")
# 2h. cancel em pedido de B
r = requests.post(f"{API}/orders/{ord_b['id']}/cancel", headers=H_A)
T("2h. A → cancel pedido B",         r.status_code == 404, f"HTTP {r.status_code}")

# ---------- 3. restaurant_id não pode ser alterado por body/querystring ----------
# 3a. body extra com restaurant_id (Pydantic ignora extras; e o valor real vem do JWT via get_tenant)
prod_a = requests.post(
    f"{API}/products",
    json={"name":"Injeção","price":1,"category":"C","active":True,"restaurant_id":"tenant-beta"},
    headers=H_A,
).json()
T("3a. body.restaurant_id ignorado — produto criado em alpha",
  prod_a.get("id") is not None and not any(p["id"]==prod_a["id"] for p in requests.get(f"{API}/products", headers=H_B).json()),
  f"prod={prod_a.get('id','?')[:8]}")
# 3b. querystring restaurant_id não é considerada
lst_hijack = requests.get(f"{API}/orders?restaurant_id=tenant-beta", headers=H_A).json()
T("3b. querystring restaurant_id=beta ignorada",
  not any(o["id"]==ord_b["id"] for o in lst_hijack),
  f"{len(lst_hijack)} pedidos retornados (todos de alpha)")
# 3c. path com id de recurso alheio → 404 (não vaza dados de outro tenant)
r = requests.get(f"{API}/orders/{ord_b['id']}", headers=H_A)
T("3c. /orders/{id-de-B} com token A → 404", r.status_code == 404, f"HTTP {r.status_code}")

# ---------- 4. role não pode ser alterada pelo frontend ----------
# 4a. tentar criar user via API com role=admin quando eu sou apenas... ok, user_a é admin.
#     Vamos primeiro sessão como waiter e tentar body com role=admin (não deveria escalar).
sess_w = exchange(sign_handoff("tenant-alpha", "waiter"))
H_W = {"Authorization": f"Bearer {sess_w['token']}"}
r = requests.post(f"{API}/users",
                  json={"name":"Hack","email":"hack@x.app","temp_password":"tempaaa","role":"admin"},
                  headers=H_W)
T("4a. waiter tenta POST /users com role=admin", r.status_code == 403, f"HTTP {r.status_code}")

# 4b. waiter tenta manipular sua própria role via update
r = requests.put(f"{API}/users/{sess_w['user']['id']}",
                 json={"name":"self","role":"admin","active":True},
                 headers=H_W)
T("4b. waiter tenta PUT /users/self com role=admin", r.status_code == 403, f"HTTP {r.status_code}")

# 4c. waiter tenta acessar endpoint privilegiado (financeiro)
r = requests.get(f"{API}/orders/stats", headers=H_W)
T("4c. waiter tenta GET /orders/stats (financeiro)", r.status_code == 403, f"HTTP {r.status_code}")

# 4d. usuário criado NÃO consegue se auto-promover injetando role via body em qualquer rota
# (nenhuma rota aceita role fora de /users, mas confirmamos que /auth/change-password também não aceita)
r = requests.post(f"{API}/auth/change-password",
                  json={"current_password":"x","new_password":"newpasses","role":"admin"},
                  headers=H_W)
# Espera-se 400 (senha atual incorreta), NUNCA 200 — o campo role é simplesmente ignorado
T("4d. /auth/change-password ignora campo role", r.status_code == 400, f"HTTP {r.status_code}")

# 4e. confirma que role no /auth/me reflete o que o Hub assinou (waiter), não admin
me_w = requests.get(f"{API}/auth/me", headers=H_W).json()
T("4e. /auth/me mostra role do JWT (waiter)", me_w["role"] == "waiter", f"role={me_w['role']!r}")

# ---------- Sumário ----------
failed = [r for r in results if not r[1]]
print(f"\n>>> {len(results)-len(failed)}/{len(results)} testes de isolamento passaram")
if failed:
    print("FALHAS:")
    for name, ok, det in failed: print(f"  - {name} — {det}")
    sys.exit(1)
