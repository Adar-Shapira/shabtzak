from datetime import date
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, insert, and_, delete
from app.db import SessionLocal
from app.models.vacation import Vacation
from app.models.soldier import Soldier

router = APIRouter(prefix="/vacations", tags=["vacations"])

class VacationIn(BaseModel):
    soldier_id: int
    start_date: date
    end_date: date

@router.get("")
def list_vacations():
    with SessionLocal() as s:
        rows = s.execute(select(Vacation).order_by(Vacation.start_date)).scalars().all()
        return [{
            "id": v.id,
            "soldier_id": v.soldier_id,
            "soldier_name": v.soldier.name if v.soldier else None,
            "start_date": v.start_date,
            "end_date": v.end_date
        } for v in rows]

@router.post("", status_code=201)
def create_vacation(payload: VacationIn):
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on/after start_date")

    with SessionLocal() as s:
        soldier = s.execute(select(Soldier).where(Soldier.id == payload.soldier_id)).scalar_one_or_none()
        if not soldier:
            raise HTTPException(status_code=400, detail="soldier_id does not exist")

        overlap = s.execute(
            select(Vacation.id).where(
                and_(
                    Vacation.soldier_id == payload.soldier_id,
                    Vacation.start_date <= payload.end_date,
                    Vacation.end_date >= payload.start_date,
                )
            )
        ).first()
        if overlap:
            raise HTTPException(status_code=409, detail="Vacation overlaps existing entry")

        new_id = s.execute(
            insert(Vacation).values(
                soldier_id=payload.soldier_id,
                start_date=payload.start_date,
                end_date=payload.end_date,
            ).returning(Vacation.id)
        ).scalar_one()
        s.commit()
        return {"id": new_id, **payload.model_dump()}

@router.delete("/{vacation_id}", status_code=204)
def delete_vacation(vacation_id: int):
    with SessionLocal() as s:
        res = s.execute(delete(Vacation).where(Vacation.id == vacation_id))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Vacation not found")
        s.commit()
        return
