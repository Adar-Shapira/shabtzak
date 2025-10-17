# backend/app/routers/vacations.py
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Path
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

class VacationDates(BaseModel):
    start_date: date
    end_date: date

def _serialize(v: Vacation) -> dict:
    return {
        "id": v.id,
        "soldier_id": v.soldier_id,
        "soldier_name": v.soldier.name if v.soldier else None,
        "start_date": v.start_date,
        "end_date": v.end_date,
    }

@router.get("")
def list_vacations(soldier_id: Optional[int] = Query(None)):
    """
    GET /vacations
    GET /vacations?soldier_id=1
    """
    with SessionLocal() as s:
        q = select(Vacation).order_by(Vacation.start_date, Vacation.id)
        if soldier_id is not None:
            soldier = s.execute(select(Soldier).where(Soldier.id == soldier_id)).scalar_one_or_none()
            if not soldier:
                raise HTTPException(status_code=404, detail="Soldier not found")
            q = q.where(Vacation.soldier_id == soldier_id)

        rows = s.execute(q).scalars().all()
        return [_serialize(v) for v in rows]

@router.post("", status_code=201)
def create_vacation(payload: VacationIn):
    """
    POST /vacations
    Body: { "soldier_id": 1, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }
    """
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date must be on/after start_date")

    with SessionLocal() as s:
        soldier = s.execute(select(Soldier).where(Soldier.id == payload.soldier_id)).scalar_one_or_none()
        if not soldier:
            raise HTTPException(status_code=400, detail="soldier_id does not exist")

        overlap = s.execute(
            select(Vacation.id).where(
                and_(                                   # <-- and_
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

        v = s.execute(select(Vacation).where(Vacation.id == new_id)).scalar_one()
        return _serialize(v)

@router.delete("/{vacation_id}", status_code=204)
def delete_vacation(vacation_id: int = Path(..., ge=1)):
    with SessionLocal() as s:
        res = s.execute(delete(Vacation).where(Vacation.id == vacation_id))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Vacation not found")
        s.commit()
        return

# ---- Soldier-scoped convenience endpoints the UI calls ----------------------

@router.get("/soldiers/{soldier_id}")
def list_vacations_for_soldier(soldier_id: int = Path(..., ge=1)):
    with SessionLocal() as s:
        soldier = s.execute(select(Soldier).where(Soldier.id == soldier_id)).scalar_one_or_none()
        if not soldier:
            raise HTTPException(status_code=404, detail="Soldier not found")
        rows = (
            s.execute(
                select(Vacation)
                .where(Vacation.soldier_id == soldier_id)
                .order_by(Vacation.start_date, Vacation.id)
            )
            .scalars()
            .all()
        )
        return [{
            "id": v.id,
            "soldier_id": v.soldier_id,
            "soldier_name": v.soldier.name if v.soldier else None,
            "start_date": v.start_date,
            "end_date": v.end_date,
        } for v in rows]

@router.post("/soldiers/{soldier_id}", status_code=201)
def create_vacation_for_soldier(
    soldier_id: int = Path(..., ge=1),
    payload: VacationDates = ...,
):
    with SessionLocal() as s:
        soldier = s.execute(select(Soldier).where(Soldier.id == soldier_id)).scalar_one_or_none()
        if not soldier:
            raise HTTPException(status_code=404, detail="Soldier not found")

        start_date = payload.start_date
        end_date = payload.end_date
        if end_date < start_date:
            raise HTTPException(status_code=400, detail="end_date must be on/after start_date")

        overlap = s.execute(
            select(Vacation.id).where(
                and_(
                    Vacation.soldier_id == soldier_id,
                    Vacation.start_date <= end_date,
                    Vacation.end_date >= start_date,
                )
            )
        ).first()
        if overlap:
            raise HTTPException(status_code=409, detail="Vacation overlaps existing entry")

        new_id = s.execute(
            insert(Vacation).values(
                soldier_id=soldier_id,
                start_date=start_date,
                end_date=end_date,
            ).returning(Vacation.id)
        ).scalar_one()
        s.commit()

        v = s.execute(select(Vacation).where(Vacation.id == new_id)).scalar_one()
        return {
            "id": v.id,
            "soldier_id": v.soldier_id,
            "soldier_name": v.soldier.name if v.soldier else None,
            "start_date": v.start_date,
            "end_date": v.end_date,
        }
    