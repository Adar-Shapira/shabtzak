# backend/app/routers/missions.py
from datetime import time
from fastapi import APIRouter, Depends, HTTPException, Path, Body
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.db import get_db
from app.models import Mission, MissionSlot
from app.schemas.mission import MissionCreate, MissionUpdate, MissionOut

router = APIRouter(prefix="/missions", tags=["missions"])

# --------------------------- Mission CRUD -----------------------------------

@router.get("", response_model=list[MissionOut])
def list_missions(db: Session = Depends(get_db)):
    return db.query(Mission).order_by(Mission.id.asc()).all()

@router.post("", response_model=MissionOut, status_code=201)
def create_mission(payload: MissionCreate, db: Session = Depends(get_db)):
    # Only name + optional total_needed now
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name is required")
    # enforce unique name at app level for nicer error than 500
    existing = db.query(Mission).filter(Mission.name == name).first()
    if existing:
        raise HTTPException(409, "Mission name already exists")

    m = Mission(name=name, total_needed=payload.total_needed)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m

@router.patch("/{mission_id}", response_model=MissionOut)
def update_mission(
    mission_id: int = Path(..., ge=1),
    payload: MissionUpdate = Body(...),
    db: Session = Depends(get_db),
):
    m = db.query(Mission).get(mission_id)
    if not m:
        raise HTTPException(404, "Mission not found")

    if payload.name is not None:
        new_name = payload.name.strip()
        if not new_name:
            raise HTTPException(400, "Name cannot be empty")
        # unique name check
        exists = db.query(Mission).filter(Mission.name == new_name, Mission.id != mission_id).first()
        if exists:
            raise HTTPException(409, "Another mission already uses that name")
        m.name = new_name

    if payload.total_needed is not None:
        if payload.total_needed < 1:
            raise HTTPException(400, "total_needed must be >= 1")
        m.total_needed = payload.total_needed

    db.commit()
    db.refresh(m)
    return m

@router.delete("/{mission_id}", status_code=204)
def delete_mission(mission_id: int = Path(..., ge=1), db: Session = Depends(get_db)):
    m = db.query(Mission).get(mission_id)
    if not m:
        raise HTTPException(404, "Mission not found")

    # If you need to block deletion when there are assignments, check here.
    db.delete(m)
    db.commit()
    return None

# --------------------------- Slots endpoints --------------------------------

class SlotCreate(BaseModel):
    start_time: time = Field(..., description="HH:MM or HH:MM:SS")
    end_time: time = Field(..., description="HH:MM or HH:MM:SS")

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def _parse_str_time(cls, v):
        # Accept "HH:MM" strings gracefully; pydantic will handle time objs
        if isinstance(v, str) and len(v) == 5:
            return f"{v}:00"
        return v

class SlotOut(BaseModel):
    id: int
    mission_id: int
    start_time: time
    end_time: time

    class Config:
        from_attributes = True

def _overlaps(a_start: time, a_end: time, b_start: time, b_end: time) -> bool:
    """
    Return True if [a_start, a_end) overlaps [b_start, b_end) with support for overnight ranges.
    Overnight means end < start (e.g., 22:00 -> 06:00).
    """
    def normalize(start: time, end: time):
        if end <= start:  # overnight, push end by 24h in minutes
            return (start.hour * 60 + start.minute, (end.hour * 60 + end.minute) + 24 * 60)
        return (start.hour * 60 + start.minute, end.hour * 60 + end.minute)

    a0, a1 = normalize(a_start, a_end)
    b0, b1 = normalize(b_start, b_end)
    # Try also shifting windows into same "day frame"
    # Compare both ways to catch cross-midnight interactions
    if a1 <= a0 or b1 <= b0:
        return True  # zero/negative duration is considered invalid/overlap

    # Two intervals overlap if they intersect with positive measure
    return not (a1 <= b0 or b1 <= a0)

@router.get("/{mission_id}/slots", response_model=list[SlotOut])
def list_slots(mission_id: int = Path(..., ge=1), db: Session = Depends(get_db)):
    m = db.query(Mission).get(mission_id)
    if not m:
        raise HTTPException(404, "Mission not found")
    rows = (
        db.query(MissionSlot)
        .filter(MissionSlot.mission_id == mission_id)
        .order_by(MissionSlot.start_time.asc())
        .all()
    )
    return rows

@router.post("/{mission_id}/slots", response_model=SlotOut, status_code=201)
def create_slot(
    mission_id: int = Path(..., ge=1),
    payload: SlotCreate = Body(...),
    db: Session = Depends(get_db),
):
    m = db.query(Mission).get(mission_id)
    if not m:
        raise HTTPException(404, "Mission not found")

    if payload.start_time == payload.end_time:
        raise HTTPException(400, "Start and end cannot be equal")

    # Overlap check against existing slots for this mission
    existing = db.query(MissionSlot).filter(MissionSlot.mission_id == mission_id).all()
    for s in existing:
        if _overlaps(payload.start_time, payload.end_time, s.start_time, s.end_time):
            raise HTTPException(400, "Slot overlaps an existing slot for this mission")

    row = MissionSlot(
        mission_id=mission_id,
        start_time=payload.start_time,
        end_time=payload.end_time,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

@router.delete("/{mission_id}/slots/{slot_id}", status_code=204)
def delete_slot(
    mission_id: int = Path(..., ge=1),
    slot_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
):
    m = db.query(Mission).get(mission_id)
    if not m:
        raise HTTPException(404, "Mission not found")

    s = db.query(MissionSlot).filter_by(id=slot_id, mission_id=mission_id).first()
    if not s:
        raise HTTPException(404, "Slot not found")

    db.delete(s)
    db.commit()
    return None
