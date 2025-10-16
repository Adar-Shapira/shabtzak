# backend/app/routers/assignments.py
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, delete
from sqlalchemy.orm import joinedload

from app.db import SessionLocal
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.mission_slot import MissionSlot

router = APIRouter(prefix="/assignments", tags=["assignments"])

class RosterItem(BaseModel):
    id: int
    soldier_id: int
    soldier_name: str
    start_at: datetime
    end_at: datetime

class RosterResponse(BaseModel):
    mission: dict
    day: str
    items: List[RosterItem]

@router.get("/roster", response_model=RosterResponse)
def roster(
    mission_id: int = Query(..., ge=1),
    day: date = Query(...),
):
    with SessionLocal() as s:
        m = s.get(Mission, mission_id)
        if not m:
            raise HTTPException(404, "Mission not found")

        windows = []
        for slot in s.query(MissionSlot).filter(MissionSlot.mission_id == mission_id).all():
            start_dt = datetime.combine(day, slot.start_time).replace(tzinfo=timezone.utc)
            end_dt = datetime.combine(day, slot.end_time).replace(tzinfo=timezone.utc)
            if end_dt <= start_dt:
                end_dt += timedelta(days=1)
            windows.append((start_dt, end_dt))

        if not windows:
            return RosterResponse(mission={"id": m.id, "name": m.name}, day=day.isoformat(), items=[])

        q = s.query(Assignment).options(joinedload(Assignment.soldier)).filter(Assignment.mission_id == mission_id)

        cond = None
        for w_start, w_end in windows:
            c = and_(Assignment.end_at > w_start, Assignment.start_at < w_end)
            cond = c if cond is None else (cond | c)
        if cond is not None:
            q = q.filter(cond)

        rows = q.order_by(Assignment.start_at.asc()).all()

        items = [
            RosterItem(
                id=a.id,
                soldier_id=a.soldier_id,
                soldier_name=a.soldier.name if a.soldier else f"#{a.soldier_id}",
                start_at=a.start_at,
                end_at=a.end_at,
            )
            for a in rows
        ]
        return RosterResponse(mission={"id": m.id, "name": m.name}, day=day.isoformat(), items=items)

class ClearPayload(BaseModel):
    mission_id: int
    day: date

    @field_validator("mission_id")
    @classmethod
    def _v_mission_id(cls, v: int) -> int:
        if v < 1:
            raise ValueError("mission_id must be positive")
        return v

@router.post("/clear")
def clear_day_for_mission(payload: ClearPayload):
    with SessionLocal() as s:
        m = s.get(Mission, payload.mission_id)
        if not m:
            raise HTTPException(404, "Mission not found")

        slots = s.query(MissionSlot).filter(MissionSlot.mission_id == m.id).all()
        if not slots:
            return {"deleted": 0}

        total_deleted = 0
        for slot in slots:
            start_dt = datetime.combine(payload.day, slot.start_time).replace(tzinfo=timezone.utc)
            end_dt = datetime.combine(payload.day, slot.end_time).replace(tzinfo=timezone.utc)
            if end_dt <= start_dt:
                end_dt += timedelta(days=1)

            res = s.execute(
                delete(Assignment).where(
                    and_(
                        Assignment.mission_id == m.id,
                        Assignment.end_at > start_dt,
                        Assignment.start_at < end_dt,
                    )
                )
            )
            total_deleted += res.rowcount or 0

        s.commit()
        return {"deleted": total_deleted}
