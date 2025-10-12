from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import update, select
from app.db import SessionLocal
from app.models.soldier import Soldier

router = APIRouter(prefix="/soldiers", tags=["soldiers"])

class SoldierUpdate(BaseModel):
    restrictions: str | None = None
    missions_history: str | None = None

@router.patch("/{soldier_id}", status_code=200)
def update_soldier(soldier_id: int, payload: SoldierUpdate):
    with SessionLocal() as s:
        exists = s.execute(select(Soldier.id).where(Soldier.id == soldier_id)).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="Soldier not found")

        values = {k: v for k, v in payload.model_dump().items() if v is not None}
        if not values:
            return {"id": soldier_id}

        s.execute(update(Soldier).where(Soldier.id == soldier_id).values(**values))
        s.commit()
        return {"id": soldier_id, **values}
