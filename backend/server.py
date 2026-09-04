"""DACOT backend — entry point.

Modular structure. Each module (auth/products/customers/orders/restaurants) has
its own routes and can evolve independently. Multi-tenant isolation is enforced
at the dependency layer (`core.deps.get_tenant`).
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import logging  # noqa: E402
import os  # noqa: E402

from fastapi import APIRouter, FastAPI  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402

from core.db import close_db, get_db  # noqa: E402
from modules.auth.routes import router as auth_router  # noqa: E402
from modules.auth.seed import ensure_indexes, seed_admin_and_restaurant  # noqa: E402
from modules.customers.routes import router as customers_router  # noqa: E402
from modules.handoff.routes import compat_router, router as handoff_router  # noqa: E402
from modules.orders.routes import router as orders_router  # noqa: E402
from modules.products.routes import router as products_router  # noqa: E402
from modules.restaurants.routes import router as restaurant_router  # noqa: E402
from modules.users.routes import router as users_router  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("dacot")

app = FastAPI(title="DACOT API", version="0.1.0")

# All routes under /api
api_router = APIRouter(prefix="/api")


@api_router.get("/health")
async def health():
    return {"status": "ok"}


# Wire modules
api_router.include_router(auth_router)
api_router.include_router(restaurant_router)
api_router.include_router(products_router)
api_router.include_router(customers_router)
api_router.include_router(orders_router)
api_router.include_router(users_router)
api_router.include_router(handoff_router)
api_router.include_router(compat_router)

app.include_router(api_router)

# CORS
# CORS_ORIGINS (opcional): lista de origens separadas por vírgula, ex.
#   CORS_ORIGINS=https://<seu-frontend>.onrender.com,https://<seu-dominio-proprio>
# Defina isso na configuração do serviço de backend (ex.: env vars do Render)
# apontando para a(s) URL(s) real(is) do frontend em produção. Sem essa
# variável, só as origens de desenvolvimento local do CRA são permitidas.
_cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins_env:
    CORS_ORIGINS = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

_cors_allow_credentials = True
if "*" in CORS_ORIGINS:
    # allow_origins=["*"] + allow_credentials=True é uma combinação inválida (o
    # navegador recusa credenciais com origem coringa) e insegura (qualquer site
    # pode chamar a API). Se CORS_ORIGINS=* for definido explicitamente, desativa
    # credentials em vez de manter essa configuração.
    logger.warning("CORS_ORIGINS='*' — desativando allow_credentials (combinação inválida com origem coringa).")
    _cors_allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_credentials=_cors_allow_credentials,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    # touch db
    _ = get_db()
    await ensure_indexes()
    await seed_admin_and_restaurant()
    logger.info("DACOT backend ready.")


@app.on_event("shutdown")
async def shutdown():
    await close_db()
