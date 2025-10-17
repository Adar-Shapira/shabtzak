# backend/app/routers/assignments.py
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import Session, joinedload

from app.db import get_db, SessionLocal
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.mission_slot import MissionSlot

from app.models.role import Role
from app.models.soldier import Soldier

from zoneinfo import ZoneInfo
import os

from sqlalchemy.sql import expression as sql


LOCAL_TZ = ZoneInfo(os.getenv("APP_TZ", "UTC"))
router = APIRouter(prefix="/assignments", tags=["assignments"])

class RosterItem(BaseModel):
    id: int
    mission: dict
    role: Optional[str] = None
    soldier_id: int
    soldier_name: str
    start_at: datetime
    end_at: datetime
    start_local: str
    end_local: str
    start_epoch_ms: int
    end_epoch_ms: int


class RosterResponse(BaseModel):
    day: str
    items: List[RosterItem]
    mission: Optional[dict] = None  # kept for backward compatibility when mission_id is provided

def _to_local(dt: datetime) -> datetime:
    return dt.astimezone(LOCAL_TZ)

def _fmt_local(dt: datetime) -> str:
    # ISO with offset (e.g. 2025-10-19T09:00:00+03:00)
    return _to_local(dt).isoformat(timespec="seconds")

def _epoch_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)

def _day_bounds(day_str: str) -> tuple[datetime, datetime]:
    # interpret "day" as local calendar day, convert to UTC for the query
    try:
        the_day = date.fromisoformat(day_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid day format; expected YYYY-MM-DD")

    start_local = datetime(the_day.year, the_day.month, the_day.day, tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


@router.get("/roster", response_model=RosterResponse)
def roster(
    day: str = Query(..., description="YYYY-MM-DD"),
    mission_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    start, end = _day_bounds(day)

    q = (
        select(Assignment)
        .options(
            joinedload(Assignment.mission),
            joinedload(Assignment.soldier),
            joinedload(Assignment.role),
        )
        .where(and_(Assignment.start_at >= start, Assignment.start_at < end))
        # ORDER BY mission id, then start time, then role_id (NULLS LAST)
        .order_by(
            Assignment.mission_id,
            Assignment.start_at,
            sql.nulls_last(Assignment.role_id.asc())
        )
    )
    if mission_id is not None:
        q = q.where(Assignment.mission_id == mission_id)

    rows: List[Assignment] = db.execute(q).scalars().all()

    items: List[RosterItem] = []
    for a in rows:
        items.append(
            RosterItem(
                id=a.id,
                mission={"id": a.mission.id, "name": a.mission.name} if a.mission else {"id": None, "name": None},
                role=a.role.name if a.role else None,
                soldier_id=a.soldier.id if a.soldier else 0,
                soldier_name=a.soldier.name if a.soldier else "",
                start_at=a.start_at,
                end_at=a.end_at,
                start_local=_fmt_local(a.start_at),
                end_local=_fmt_local(a.end_at),
                start_epoch_ms=_epoch_ms(a.start_at),
                end_epoch_ms=_epoch_ms(a.end_at),   
            )
        )

    top_mission = None
    if mission_id is not None:
        if rows and rows[0].mission:
            top_mission = {"id": rows[0].mission.id, "name": rows[0].mission.name}
        else:
            m = db.execute(select(Mission).where(Mission.id == mission_id)).scalars().first()
            if m:
                top_mission = {"id": m.id, "name": m.name}

    return RosterResponse(day=day, items=items, mission=top_mission)


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
            # slot times are local; convert to UTC window for overlap delete
            start_local = datetime.combine(payload.day, slot.start_time).replace(tzinfo=LOCAL_TZ)
            end_local = datetime.combine(payload.day, slot.end_time).replace(tzinfo=LOCAL_TZ)
            if end_local <= start_local:
                end_local += timedelta(days=1)
            start_dt = start_local.astimezone(timezone.utc)
            end_dt   = end_local.astimezone(timezone.utc)

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
    

class DayRosterItem(BaseModel):
    id: int
    mission: dict | None
    role: str | None = None
    soldier_id: int
    soldier_name: str
    start_at: datetime
    end_at: datetime

class DayRosterResponse(BaseModel):
    day: str
    items: List[DayRosterItem]

def _bounds_for_day(day_str: str) -> tuple[datetime, datetime]:
    # same logic as _day_bounds, kept for day_roster
    try:
        d = date.fromisoformat(day_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid day format; expected YYYY-MM-DD")
    start_local = datetime(d.year, d.month, d.day, tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)

@router.get("/day-roster", response_model=DayRosterResponse)
def day_roster(
    day: str = Query(..., description="YYYY-MM-DD"),
    db=Depends(get_db),
):
    start, end = _bounds_for_day(day)

    rows = (
        db.execute(
            select(Assignment)
            .options(
                joinedload(Assignment.mission),
                joinedload(Assignment.soldier),
                joinedload(Assignment.role),
            )
            .where(and_(Assignment.start_at >= start, Assignment.start_at < end))
            .order_by(
                Assignment.mission_id,
                Assignment.start_at,
                sql.nulls_last(Assignment.role_id.asc())
            )
        )
        .scalars()
        .all()
    )

    items: List[DayRosterItem] = []
    for a in rows:
        items.append(
            DayRosterItem(
                id=a.id,
                mission={"id": a.mission.id, "name": a.mission.name} if a.mission else None,
                role=a.role.name if a.role else None,
                soldier_id=a.soldier.id if a.soldier else 0,
                soldier_name=a.soldier.name if a.soldier else "",
                start_at=a.start_at,
                end_at=a.end_at,
                start_local=_fmt_local(a.start_at),
                end_local=_fmt_local(a.end_at),
                start_epoch_ms=_epoch_ms(a.start_at),
                end_epoch_ms=_epoch_ms(a.end_at),
            )
        )
    return DayRosterResponse(day=day, items=items)
