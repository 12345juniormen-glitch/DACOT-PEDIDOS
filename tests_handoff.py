"""Handoff exchange — full test battery (23 cases)."""
import json, os, sys, time, uuid, requests
import jwt as pyjwt

API = "http://localhost:8001/api"
SECRET = "test-handoff-secret-32-bytes-long-string"
ISS = "dacot-hub"
AUD = "dacot-orders"

def make_handoff(**overrides):
    now = int(time.time())
    claims = {
        "sub": "tenant_user:hub-user-" + uuid.uuid4().hex[:8],
        "restaurant_id": overrides.pop("restaurant_id", "tenant-alpha"),
        "role": "waiter",
        "module": "orders",
        "iss": ISS,
        "aud": AUD,
        "iat": now,
        "nbf": now - 5,
        "exp": now + 60,
        "jti": uuid.uuid4().hex,
        "handoff_version": 1,
    }
    claims.update(overrides)
    # Filter out None values (used to remove required claims)
    claims = {k: v for k, v in claims.items() if v is not None}
    secret = overrides.pop("_secret", SECRET) if "_secret" in overrides else SECRET
    algo = overrides.pop("_algo", "HS256") if "_algo" in overrides else "HS256"
    return pyjwt.encode(claims, secret, algorithm=algo)

def call(handoff):
    r = requests.post(f"{API}/session/exchange", json={"handoff": handoff}, timeout=5)
    return r.status_code, (r.json() if r.headers.get("content-type","").startswith("application/json") else r.text)

results = []
def T(name, expected_status, handoff, extra_check=None):
    code, body = call(handoff)
    ok = (code == expected_status) and (extra_check(body) if extra_check else True)
    results.append((name, ok, code, body))
    icon = "✅" if ok else "❌"
    detail = body.get("detail", body) if isinstance(body, dict) else str(body)[:80]
    print(f"{icon} [{code}={expected_status}] {name}: {detail}")

# 1. handoff válido
h = make_handoff(role="waiter", restaurant_id="tenant-alpha")
T("01 handoff válido", 200, h, lambda b: b.get("user",{}).get("role")=="waiter" and b.get("user",{}).get("restaurant_id")=="tenant-alpha")

# 2. assinatura inválida (mesmo algoritmo, chave diferente)
h_bad = pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"t","role":"waiter","module":"orders","iss":ISS,"aud":AUD,"iat":int(time.time()),"nbf":int(time.time()),"exp":int(time.time())+60,"jti":uuid.uuid4().hex,"handoff_version":1}, "wrong-secret", algorithm="HS256")
T("02 assinatura inválida", 401, h_bad)

# 3. segredo incorreto (idem #2 conceitualmente, mas testando alg diferente HS512)
h_alg = pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"t","role":"waiter","module":"orders","iss":ISS,"aud":AUD,"iat":int(time.time()),"nbf":int(time.time()),"exp":int(time.time())+60,"jti":uuid.uuid4().hex,"handoff_version":1}, SECRET, algorithm="HS512")
T("03 algoritmo/segredo incorreto", 401, h_alg)

# 4. expirado
now = int(time.time())
h_exp = pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"tenant-alpha","role":"waiter","module":"orders","iss":ISS,"aud":AUD,"iat":now-3600,"nbf":now-3600,"exp":now-60,"jti":uuid.uuid4().hex,"handoff_version":1}, SECRET, algorithm="HS256")
T("04 token expirado", 401, h_exp)

# 5. nbf no futuro
h_nbf = pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"tenant-alpha","role":"waiter","module":"orders","iss":ISS,"aud":AUD,"iat":now,"nbf":now+3600,"exp":now+7200,"jti":uuid.uuid4().hex,"handoff_version":1}, SECRET, algorithm="HS256")
T("05 nbf no futuro", 401, h_nbf)

# 6. issuer errado
T("06 issuer inválido", 401, make_handoff(iss="attacker"))

# 7. audience errada
T("07 audience inválida", 401, make_handoff(aud="other-module"))

# 8. module inválido
T("08 module inválido", 401, make_handoff(module="billing"))

# 9. role inválida
T("09 role inválida", 401, make_handoff(role="superuser"))

# 10. restaurant_id ausente
T("10 restaurant_id ausente", 401, make_handoff(restaurant_id=""))

# 11. sub ausente (build manually)
h11 = pyjwt.encode({"restaurant_id":"tenant-alpha","role":"waiter","module":"orders","iss":ISS,"aud":AUD,"iat":now,"nbf":now,"exp":now+60,"jti":uuid.uuid4().hex,"handoff_version":1}, SECRET, algorithm="HS256")
T("11 sub ausente", 401, h11)

# 12. jti ausente
h12 = pyjwt.encode({"sub":"tenant_user:x","restaurant_id":"tenant-alpha","role":"waiter","module":"orders","iss":ISS,"aud":AUD,"iat":now,"nbf":now,"exp":now+60,"handoff_version":1}, SECRET, algorithm="HS256")
T("12 jti ausente", 401, h12)

# 13. replay do mesmo jti
h13 = make_handoff(restaurant_id="tenant-alpha")
code1, _ = call(h13)
code2, body2 = call(h13)
ok13 = code1 == 200 and code2 == 401
results.append(("13 replay jti", ok13, f"{code1}/{code2}", body2))
print(f"{'✅' if ok13 else '❌'} [{code1}/{code2}] 13 replay jti: {body2.get('detail') if isinstance(body2,dict) else body2}")

# 14. módulo inativo (tenant começa com "inactive-")
T("14 módulo inativo", 403, make_handoff(restaurant_id="inactive-tenant-x"))

# 15. tenant inexistente no hub
T("15 tenant inexistente", 403, make_handoff(restaurant_id="unknown-tenant-y"))

# 16-18. sessão criada corretamente (com role/restaurant_id corretos)
h_admin = make_handoff(role="admin", restaurant_id="tenant-beta")
code, body = call(h_admin)
token = body.get("token")
ok16 = code == 200 and bool(token)
ok17 = body.get("user",{}).get("restaurant_id") == "tenant-beta"
ok18 = body.get("user",{}).get("role") == "admin"
results += [("16 sessão criada",ok16,code,body),("17 restaurant_id correto",ok17,code,body),("18 role correto",ok18,code,body)]
print(f"{'✅' if ok16 else '❌'} 16 sessão criada"); print(f"{'✅' if ok17 else '❌'} 17 restaurant_id correto"); print(f"{'✅' if ok18 else '❌'} 18 role correto")

# 19. isolamento: user do tenant-beta NÃO acessa dados de tenant-alpha
# Criar pedido em tenant-alpha via handoff, e tentar visualizá-lo autenticado como tenant-beta
h_alpha_admin = make_handoff(role="admin", restaurant_id="tenant-alpha")
tok_alpha = call(h_alpha_admin)[1]["token"]
# Precisa criar produto em tenant-alpha primeiro
prod = requests.post(f"{API}/products", json={"name":"P","price":10,"category":"C","active":True}, headers={"Authorization":f"Bearer {tok_alpha}"}).json()
order = requests.post(f"{API}/orders", json={"items":[{"product_id":prod["id"],"quantity":1}]}, headers={"Authorization":f"Bearer {tok_alpha}"}).json()
# Agora com token do beta, tentar acessar
tok_beta = token
r_leak = requests.get(f"{API}/orders/{order['id']}", headers={"Authorization":f"Bearer {tok_beta}"})
ok19 = r_leak.status_code == 404
results.append(("19 A não vê dados de B", ok19, r_leak.status_code, r_leak.text[:80]))
print(f"{'✅' if ok19 else '❌'} 19 A não vê dados de B: HTTP {r_leak.status_code}")

# 20. login normal continua funcionando
r_login = requests.post(f"{API}/auth/login", json={"email":"admin@dacot.app","password":"admin123"})
ok20 = r_login.status_code == 200 and "token" in r_login.json()
results.append(("20 login normal funciona", ok20, r_login.status_code, r_login.json()))
print(f"{'✅' if ok20 else '❌'} 20 login normal funciona: HTTP {r_login.status_code}")

# 21. logout normal
tok_admin = r_login.json()["token"]
r_logout = requests.post(f"{API}/auth/logout", headers={"Authorization":f"Bearer {tok_admin}"})
ok21 = r_logout.status_code == 200
results.append(("21 logout funciona", ok21, r_logout.status_code, r_logout.text))
print(f"{'✅' if ok21 else '❌'} 21 logout funciona: HTTP {r_logout.status_code}")

# 22 e 23 são verificações de frontend — testadas depois via console/script no Playwright
print("\n22-23: testes de frontend (URL/localStorage) serão executados via browser")

failed = [r for r in results if not r[1]]
print(f"\n>>> {len(results)-len(failed)}/{len(results)} testes passaram")
if failed:
    print("FALHAS:")
    for r in failed: print("  -", r[0], "→", r[2], r[3])
    sys.exit(1)
