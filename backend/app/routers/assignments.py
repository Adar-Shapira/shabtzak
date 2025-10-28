# backend/app/routers/assignments.py
from __future__ import annotations

from datetime import date, datetime, timedelta, time
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from pydantic import BaseModel, field_validator
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError

from app.db import get_db, SessionLocal
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.mission_slot import MissionSlot
from app.models.role import Role
from app.models.soldier import Soldier
from app.models.soldier_mission_restriction import SoldierMissionRestriction

from math import floor

from sqlalchemy.sql import expression as sql

router = APIRouter(prefix="/assignments", tags=["assignments"])

def _local_midnight_bounds(day_str: str) -> tuple[datetime, datetime]:
    try:
        d = date.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid day format, expected YYYY-MM-DD")
    start_local = datetime(d.year, d.month, d.day, 0, 0, 0)
    end_local = start_local + timedelta(days=1)
    return start_local, end_local

class RosterItem(BaseModel):
    id: int
    mission: dict
    role: Optional[str] = None
    role_id: Optional[int] = None  # NEW: role ID for exclusion feature
    soldier_id: Optional[int] = None
    soldier_name: str
    start_at: str
    end_at: str
    start_local: str
    end_local: str
    start_epoch_ms: int
    end_epoch_ms: int


class RosterResponse(BaseModel):
    day: str
    items: List[RosterItem]
    mission: Optional[dict] = None  # kept for backward compatibility when mission_id is provided
    
def _naive(dt: datetime) -> datetime:
    return dt if dt.tzinfo is None else dt.replace(tzinfo=None)

def _epoch_ms(dt: datetime) -> int:
    """Calculate epoch milliseconds from naive datetime without timezone conversion."""
    d = _naive(dt)
    epoch = datetime(1970, 1, 1)
    return int((d - epoch).total_seconds() * 1000)

def _naive_timestamp(dt: datetime) -> int:
    """Calculate timestamp from naive datetime without timezone conversion."""
    d = _naive(dt)
    epoch = datetime(1970, 1, 1)
    return int((d - epoch).total_seconds())

def _day_bounds(day_str: str) -> tuple[datetime, datetime]:
    try:
        the_day = date.fromisoformat(day_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid day format; expected YYYY-MM-DD")
    start_local = datetime(the_day.year, the_day.month, the_day.day)
    end_local = start_local + timedelta(days=1)
    return start_local, end_local

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
        # Only assignments whose start is on this local day
        .where(and_(Assignment.start_at >= start, Assignment.start_at < end))
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
                role_id=a.role_id,  # NEW: include role ID
                soldier_id=a.soldier.id if a.soldier else None,
                soldier_name=a.soldier.name if a.soldier else "",
                start_at=_naive(a.start_at).isoformat(timespec="seconds"),
                end_at=_naive(a.end_at).isoformat(timespec="seconds"),
                start_local=_naive(a.start_at).isoformat(timespec="seconds"),
                end_local=_naive(a.end_at).isoformat(timespec="seconds"),
                start_epoch_ms=_epoch_ms(a.start_at),
                end_epoch_ms=_epoch_ms(a.end_at),
            )
        )

    # mission header logic unchanged...
    top_mission = None
    if mission_id is not None:
        if rows and rows[0].mission:
            top_mission = {"id": rows[0].mission.id, "name": rows[0].mission.name}
        else:
            m = db.execute(select(Mission).where(Mission.id == mission_id)).scalars().first()
            if m:
                top_mission = {"id": m.id, "name": m.name}

    return RosterResponse(day=day, items=items, mission=top_mission)

class ClearRequest(BaseModel):
    day: str  # YYYY-MM-DD
    mission_ids: Optional[List[int]] = None
    locked_assignment_ids: Optional[List[int]] = None

@router.post("/clear")
def clear_plan(payload: dict, db: Session = Depends(get_db)):
    day = payload.get("day")
    if not day:
        raise HTTPException(status_code=400, detail="Missing 'day'")

    mission_ids = payload.get("mission_ids") or None
    locked_assignment_ids = payload.get("locked_assignment_ids") or None
    day_start, day_end = _local_midnight_bounds(day)

    conds = [
        Assignment.start_at >= day_start,
        Assignment.start_at <  day_end,
    ]

    if mission_ids:
        conds.append(Assignment.mission_id.in_(mission_ids))
    
    # Exclude locked assignments from deletion
    if locked_assignment_ids:
        conds.append(~Assignment.id.in_(locked_assignment_ids))

    db.execute(delete(Assignment).where(and_(*conds)))
    db.commit()
    return {"ok": True} 

class DayRosterItem(BaseModel):
    id: int
    mission: dict | None
    role: str | None = None
    soldier_id: Optional[int] = None
    soldier_name: str
    start_at: str
    end_at: str
    start_local: str
    end_local: str
    start_epoch_ms: int
    end_epoch_ms: int

class DayRosterResponse(BaseModel):
    day: str
    items: List[DayRosterItem]

def _bounds_for_day(day_str: str) -> tuple[datetime, datetime]:
    try:
        d = date.fromisoformat(day_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid day format; expected YYYY-MM-DD")
    start_local = datetime(d.year, d.month, d.day)
    end_local = start_local + timedelta(days=1)
    return start_local, end_local

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
            # CHANGE: overlap filter
            .where(and_(Assignment.end_at > start, Assignment.start_at < end))
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
                soldier_id=a.soldier.id if a.soldier else None,
                soldier_name=a.soldier.name if a.soldier else "",
                start_at=_naive(a.start_at).isoformat(timespec="seconds"),
                end_at=_naive(a.end_at).isoformat(timespec="seconds"),
                start_local=_naive(a.start_at).isoformat(timespec="seconds"),
                end_local=_naive(a.end_at).isoformat(timespec="seconds"),
                start_epoch_ms=_epoch_ms(a.start_at),
                end_epoch_ms=_epoch_ms(a.end_at),
            )
        )

    return DayRosterResponse(day=day, items=items)

class ReassignRequest(BaseModel):
    assignment_id: int
    soldier_id: int
    ignore_rules: bool = False  # when True, do not block; auto-resolve conflicts

@router.post("/reassign")
def reassign_assignment(body: ReassignRequest, db: Session = Depends(get_db)):
    a = db.get(Assignment, body.assignment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")

    s = db.get(Soldier, body.soldier_id)
    if not s:
        raise HTTPException(status_code=404, detail="Soldier not found")

    # Optional warning we may return
    warning_restriction: str | None = None

    # Mission restriction check (same behavior)
    if a.mission_id:
        restricted = (
            db.query(SoldierMissionRestriction)
              .filter(
                  SoldierMissionRestriction.soldier_id == s.id,
                  SoldierMissionRestriction.mission_id == a.mission_id,
              )
              .first()
        )
        if restricted and not body.ignore_rules:
            raise HTTPException(status_code=400, detail="Soldier is restricted from this mission")
        if restricted and body.ignore_rules:
            warning_restriction = "IGNORED: soldier is restricted from this mission"

    # 👉 Do NOT auto-unassign overlapping assignments anymore.
    # We simply set the soldier and commit. If your DB has an exclusion/unique constraint
    # that forbids overlaps, this will raise and we surface the error.

    a.soldier_id = s.id
    db.add(a)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        # No cleanup/unassign of other overlaps; just report the constraint failure.
        raise HTTPException(status_code=400, detail="Cannot reassign due to a DB constraint") from e

    db.refresh(a)

    start_local = _naive(a.start_at).isoformat(timespec="seconds")
    end_local   = _naive(a.end_at).isoformat(timespec="seconds")
    
    # Convert to string for JSON serialization without timezone shifts
    start_at_str = _naive(a.start_at).isoformat(timespec="seconds")
    end_at_str = _naive(a.end_at).isoformat(timespec="seconds")

    return {
        "id": a.id,
        "mission": {"id": a.mission.id, "name": a.mission.name} if a.mission else None,
        "role": a.role.name if a.role else None,
        "soldier_id": a.soldier_id,
        "soldier_name": a.soldier.name if a.soldier else "",
        "start_at": start_at_str,
        "end_at": end_at_str,
        "start_local": start_local,
        "end_local": end_local,
        "start_epoch_ms": _epoch_ms(a.start_at),
        "end_epoch_ms": _epoch_ms(a.end_at),
        "warnings": ([warning_restriction] if warning_restriction else []),
    }

class CreateAssignmentRequest(BaseModel):
    day: str
    mission_id: int
    role_id: Optional[int] = None
    start_time: str   # "HH:MM" or "HH:MM:SS"
    end_time: str     # "HH:MM" or "HH:MM:SS"
    soldier_id: Optional[int] = None  # null means create placeholder only if your schema allows

def _with_seconds(x: str) -> str:
    return x if len(x) >= 8 else (x + ":00")

def _parse_time(hms: str) -> time:
    parts = [int(p) for p in hms.split(":")]
    if len(parts) == 2:
        parts.append(0)
    return time(parts[0], parts[1], parts[2])

@router.post("/create")
def create_assignment(body: CreateAssignmentRequest, db: Session = Depends(get_db)):
    # compute window in UTC using your existing helper
    the_day = date.fromisoformat(body.day)
    start_at, end_at = Assignment.window_for(
        _parse_time(_with_seconds(body.start_time)),
        _parse_time(_with_seconds(body.end_time)),
        the_day
    )

    # If your schema requires soldier_id NOT NULL, reject null soldier_id:
    if body.soldier_id is None:
        # either 400, or allow if your DB column is nullable
        # raise HTTPException(status_code=400, detail="soldier_id is required")
        pass

    a = Assignment(
        mission_id=body.mission_id,
        soldier_id=body.soldier_id,
        role_id=body.role_id,
        start_at=start_at,
        end_at=end_at,
    )
    db.add(a)
    db.commit()
    db.refresh(a)

    start_local = _naive(a.start_at).isoformat(timespec="seconds")
    end_local   = _naive(a.end_at).isoformat(timespec="seconds")
    
    # Convert to string for JSON serialization without timezone shifts
    start_at_str = _naive(a.start_at).isoformat(timespec="seconds")
    end_at_str = _naive(a.end_at).isoformat(timespec="seconds")

    return {
        "id": a.id,
        "mission": {"id": a.mission.id, "name": a.mission.name} if a.mission else None,
        "role": a.role.name if a.role else None,
        "soldier_id": a.soldier_id,
        "soldier_name": a.soldier.name if a.soldier else "",
        "start_at": start_at_str,
        "end_at": end_at_str,
        "start_local": start_local,
        "end_local": end_local,
        "start_epoch_ms": _epoch_ms(a.start_at),
        "end_epoch_ms": _epoch_ms(a.end_at),
    }

@router.delete("/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    a = db.get(Assignment, assignment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    # Don't allow deletion of locked assignments (they should be unlocked first)
    # Note: We can't check this server-side without knowing which assignments are locked
    # The frontend should prevent deletion of locked assignments
    # But we'll add a comment here for documentation
    
    db.delete(a)
    db.commit()
    return {"deleted": assignment_id}