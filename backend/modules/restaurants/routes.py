"""Restaurants — placeholder module for the current tenant (future: signup, plans)."""
from fastapi import APIRouter, Depends, HTTPException

from core.db import get_db
from core.deps import Tenant, get_tenant

router = APIRouter(prefix="/restaurant", tags=["restaurant"])


@router.get("/current")
async def get_current_restaurant(tenant: Tenant = Depends(get_tenant)):
    db = get_db()
    r = await db.restaurants.find_one({"id": tenant.restaurant_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Restaurante não encontrado")
    return r
