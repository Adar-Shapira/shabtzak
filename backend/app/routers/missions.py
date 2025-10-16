# backend/app/routers/missions.py
from datetime import date, time, datetime
from typing import List

from fastapi import APIRouter, HTTPException, Query, Depends, Path
from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db, SessionLocal
from app.models.mission import Mission
from app.models.mission_slot import MissionSlot
from app.models.assignment import Assignment
from app.models.soldier import Soldier
from app.schemas.mission import MissionCreate, MissionUpdate, MissionOut
from app.schemas.mission_slot import MissionSlotCreate, MissionSlotRead, MissionSlotUpdate

router = APIRouter(prefix="/missions", tags=["missions"])

# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _has_named_role(sol: Soldier, role_name: str) -> bool:
    """True if soldier has a role with this exact name (many-to-many)."""
    try:
        return any(r.name == role_name for r in (sol.roles or []))
    except Exception:
        return False


def _bucket(sol: Soldier) -> str:
    """Canonical bucket used for coverage counts."""
    for name in ("Officer", "Commander", "Driver"):
        if _has_named_role(sol, name):
            return name
    return "Soldier"


def _time_in_range(t: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= t < end
    return t >= start or t < end


def slots_overlap(a_start: time, a_end: time, b_start: time, b_end: time) -> bool:
    return _time_in_range(a_start, b_start, b_end) or _time_in_range(b_start, a_start, a_end)


def _tstr(t: time | None) -> str | None:
    return t.isoformat() if t is not None else None

# ----------------------------------------------------------------------
# Missions CRUD
# ----------------------------------------------------------------------
@router.get("", response_model=List[MissionOut])
def list_missions(db: Session = Depends(get_db)):
    """List all missions (start/end may be null)."""
    rows = db.scalars(select(Mission).order_by(Mission.id)).all()
    return rows


@router.post("", response_model=MissionOut, status_code=201)
def create_mission(payload: MissionCreate, db: Session = Depends(get_db)):
    """Create a mission. start_time/end_time are optional."""
    try:
        sh = payload.start_time.time() if payload.start_time else None
        eh = payload.end_time.time() if payload.end_time else None

        new_id = db.execute(
            insert(Mission).values(
                name=payload.name.strip(),
                required_soldiers=payload.required_soldiers,
                required_commanders=payload.required_commanders,
                required_officers=payload.required_officers,
                required_drivers=payload.required_drivers,
                start_hour=sh,
                end_hour=eh,
            ).returning(Mission.id)
        ).scalar_one()
        db.commit()
        return db.get(Mission, new_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Mission name already exists")


@router.patch("/{mission_id}", response_model=MissionOut)
def update_mission(mission_id: int, payload: MissionUpdate, db: Session = Depends(get_db)):
    """Update a mission; times may be set or cleared."""
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    values = payload.model_dump(exclude_unset=True)

    if "start_time" in values:
        st = values.pop("start_time")
        values["start_hour"] = st.time() if isinstance(st, datetime) else None
    if "end_time" in values:
        et = values.pop("end_time")
        values["end_hour"] = et.time() if isinstance(et, datetime) else None

    if not values:
        return mission

    try:
        db.execute(update(Mission).where(Mission.id == mission_id).values(**values))
        db.commit()
        return db.get(Mission, mission_id)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Mission name already exists")


@router.delete("/{mission_id}", status_code=204)
def delete_mission(mission_id: int, db: Session = Depends(get_db)):
    """Delete a mission if it has no assignments."""
    has_asg = db.scalar(
        select(func.count()).select_from(Assignment).where(Assignment.mission_id == mission_id)
    )
    if has_asg:
        raise HTTPException(status_code=400, detail="Mission has assignments; clear them first")

    res = db.execute(delete(Mission).where(Mission.id == mission_id))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Mission not found")
    db.commit()
    return None


# ----------------------------------------------------------------------
# Coverage
# ----------------------------------------------------------------------
@router.get("/{mission_id}/slots/{slot_id}/coverage")
def mission_slot_coverage(
    mission_id: int,
    slot_id: int,
    day: date = Query(..., description="Calendar day in YYYY-MM-DD"),
    db: Session = Depends(get_db),
):
    """
    Coverage per slot for a given day.
    Counts assigned soldiers by canonical bucket (Officer > Commander > Driver > Soldier).
    """
    slot = db.get(MissionSlot, slot_id)
    if not slot or slot.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="Slot not found")

    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    # Compute absolute window (supports overnight)
    start_at, end_at = Assignment.window_for(slot.start_time, slot.end_time, day)

    rows = db.execute(
        select(Assignment, Soldier)
        .join(Soldier, Soldier.id == Assignment.soldier_id)
        .where(
            Assignment.mission_id == mission_id,
            Assignment.start_at == start_at,
            Assignment.end_at == end_at,
        )
    ).all()

    counts = {"Officer": 0, "Commander": 0, "Driver": 0, "Soldier": 0}
    for _a, sol in rows:
        counts[_bucket(sol)] += 1

    still = {
        "officers": max(0, mission.required_officers - counts["Officer"]),
        "commanders": max(0, mission.required_commanders - counts["Commander"]),
        "drivers": max(0, mission.required_drivers - counts["Driver"]),
        "soldiers": max(0, mission.required_soldiers - counts["Soldier"]),
    }

    return {
        "mission": {"id": mission.id, "name": mission.name},
        "slot": {
            "id": slot.id,
            "start_time": slot.start_time.strftime("%H:%M"),
            "end_time": slot.end_time.strftime("%H:%M"),
            "start_at": _tstr(start_at),
            "end_at": _tstr(end_at),
        },
        "required": {
            "officers": mission.required_officers,
            "commanders": mission.required_commanders,
            "drivers": mission.required_drivers,
            "soldiers": mission.required_soldiers,
        },
        "assigned": {
            "officers": counts["Officer"],
            "commanders": counts["Commander"],
            "drivers": counts["Driver"],
            "soldiers": counts["Soldier"],
        },
        "still_needed": still,
    }


# ----------------------------------------------------------------------
# Mission Slots
# ----------------------------------------------------------------------
@router.get("/{mission_id}/slots", response_model=List[MissionSlotRead])
def list_mission_slots(mission_id: int, db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    slots = db.scalars(
        select(MissionSlot)
        .where(MissionSlot.mission_id == mission_id)
        .order_by(MissionSlot.start_time)
    ).all()
    return slots


@router.post("/{mission_id}/slots", response_model=MissionSlotRead, status_code=201)
def create_mission_slot(mission_id: int, payload: MissionSlotCreate, db: Session = Depends(get_db)):
    mission = db.get(Mission, mission_id)
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")

    exists = db.scalar(
        select(MissionSlot).where(
            MissionSlot.mission_id == mission_id,
            MissionSlot.start_time == payload.start_time,
            MissionSlot.end_time == payload.end_time,
        )
    )
    if exists:
        raise HTTPException(status_code=409, detail="Slot with same range already exists")

    existing = db.scalars(select(MissionSlot).where(MissionSlot.mission_id == mission_id)).all()
    for s in existing:
        if slots_overlap(payload.start_time, payload.end_time, s.start_time, s.end_time):
            raise HTTPException(
                status_code=409,
                detail=f"Overlaps existing slot {s.start_time.strftime('%H:%M')}-{s.end_time.strftime('%H:%M')}",
            )

    slot = MissionSlot(mission_id=mission_id, start_time=payload.start_time, end_time=payload.end_time)
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return slot


@router.patch("/{mission_id}/slots/{slot_id}", response_model=MissionSlotRead)
def update_mission_slot(
    mission_id: int,
    slot_id: int = Path(..., ge=1),
    payload: MissionSlotUpdate = ...,
    db: Session = Depends(get_db),
):
    slot = db.get(MissionSlot, slot_id)
    if not slot or slot.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="Slot not found")

    start = payload.start_time if payload.start_time is not None else slot.start_time
    end = payload.end_time if payload.end_time is not None else slot.end_time
    if start == end:
        raise HTTPException(status_code=400, detail="end_time must differ from start_time")

    siblings = db.scalars(
        select(MissionSlot).where(MissionSlot.mission_id == mission_id, MissionSlot.id != slot_id)
    ).all()
    for s in siblings:
        if s.start_time == start and s.end_time == end:
            raise HTTPException(status_code=409, detail="Slot with same range already exists")
        if slots_overlap(start, end, s.start_time, s.end_time):
            raise HTTPException(
                status_code=409,
                detail=f"Overlaps existing slot {s.start_time.strftime('%H:%M')}-{s.end_time.strftime('%H:%M')}",
            )

    slot.start_time = start
    slot.end_time = end
    db.commit()
    db.refresh(slot)
    return slot


@router.delete("/{mission_id}/slots/{slot_id}", status_code=204)
def delete_mission_slot(mission_id: int, slot_id: int, db: Session = Depends(get_db)):
    slot = db.get(MissionSlot, slot_id)
    if not slot or slot.mission_id != mission_id:
        raise HTTPException(status_code=404, detail="Slot not found")
    db.delete(slot)
    db.commit()
    return None
