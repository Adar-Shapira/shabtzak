# backend/app/routers/roles.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models.role import Role
from app.models.soldier_role import SoldierRole

router = APIRouter(prefix="/roles", tags=["roles"])

class RoleIn(BaseModel):
    name: str

class RoleUpdate(BaseModel):
    name: str | None = None

@router.get("")
def list_roles():
    with SessionLocal() as s:
        rows = s.execute(select(Role).order_by(Role.id)).scalars().all()
        return [{"id": r.id, "name": r.name} for r in rows]

@router.post("", status_code=201)
def create_role(payload: RoleIn):
    with SessionLocal() as s:
        try:
            rid = s.execute(
                insert(Role)
                .values(name=payload.name.strip())
                .returning(Role.id)
            ).scalar_one()
            s.commit()
            return {"id": rid}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Role name already exists")

@router.patch("/{role_id}")
def update_role(role_id: int, payload: RoleUpdate):
    with SessionLocal() as s:
        values = {k: v for k, v in payload.model_dump().items() if v is not None}
        if "name" in values:
            values["name"] = values["name"].strip()
        if not values:
            return {"id": role_id}
        try:
            res = s.execute(update(Role).where(Role.id == role_id).values(**values))
            if res.rowcount == 0:
                raise HTTPException(status_code=404, detail="Role not found")
            s.commit()
            return {"id": role_id}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Role name already exists")

@router.delete("/{role_id}", status_code=204)
def delete_role(role_id: int):
    with SessionLocal() as s:
        # Block delete if any soldier uses this role
        in_use = s.execute(
            select(func.count()).select_from(SoldierRole).where(SoldierRole.role_id == role_id)
        ).scalar_one()
        if in_use:
            raise HTTPException(status_code=400, detail="Role is assigned to soldiers")
        res = s.execute(delete(Role).where(Role.id == role_id))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Role not found")
        s.commit()
        return None
