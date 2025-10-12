from datetime import date, time
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select, insert, update
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models.mission import Mission
from app.models.assignment import Assignment
from app.models.soldier import Soldier

from sqlalchemy import func

router = APIRouter(prefix="/missions", tags=["missions"])


# -----------------------------
# Helpers for role handling
# -----------------------------
def _has_named_role(sol: Soldier, role_name: str) -> bool:
    """True if soldier has a role with this exact name (many-to-many)."""
    try:
        return any(r.name == role_name for r in (sol.roles or []))
    except Exception:
        return False


def _bucket(sol: Soldier) -> str:
    """
    Canonical bucket used for coverage counts.
    Priority: Officer > Commander > Driver > Soldier
    """
    for name in ("Officer", "Commander", "Driver"):
        if _has_named_role(sol, name):
            return name
    return "Soldier"


# -----------------------------
# Pydantic models
# -----------------------------
class MissionIn(BaseModel):
    name: str
    start_hour: time
    end_hour: time
    required_soldiers: int = 0
    required_commanders: int = 0
    required_officers: int = 0
    required_drivers: int = 0

    @field_validator("start_hour", "end_hour", mode="before")
    @classmethod
    def _coerce_time(cls, v):
        # allow "HH:MM" strings
        if isinstance(v, str) and len(v) == 5 and v.count(":") == 1:
            from datetime import time as _t
            return _t.fromisoformat(v + ":00")
        return v


class MissionUpdate(BaseModel):
    name: Optional[str] = None
    start_hour: Optional[time] = None
    end_hour: Optional[time] = None
    required_soldiers: Optional[int] = None
    required_commanders: Optional[int] = None
    required_officers: Optional[int] = None
    required_drivers: Optional[int] = None

    @field_validator("start_hour", "end_hour", mode="before")
    @classmethod
    def _coerce_time(cls, v):
        if isinstance(v, str) and len(v) == 5 and v.count(":") == 1:
            from datetime import time as _t
            return _t.fromisoformat(v + ":00")
        return v


# -----------------------------
# Routes
# -----------------------------
@router.get("")
def list_missions():
    with SessionLocal() as s:
        rows: List[Mission] = s.execute(
            select(Mission).order_by(Mission.id)
        ).scalars().all()
        return [{
            "id": m.id,
            "name": m.name,
            "start_hour": m.start_hour.isoformat(),
            "end_hour": m.end_hour.isoformat(),
            "required_soldiers": m.required_soldiers,
            "required_commanders": m.required_commanders,
            "required_officers": m.required_officers,
            "required_drivers": m.required_drivers,
        } for m in rows]


@router.post("", status_code=201)
def create_mission(payload: MissionIn):
    if payload.end_hour <= payload.start_hour:
        raise HTTPException(status_code=400, detail="end_hour must be after start_hour")
    with SessionLocal() as s:
        try:
            new_id = s.execute(
                insert(Mission).values(
                    name=payload.name.strip(),
                    start_hour=payload.start_hour,
                    end_hour=payload.end_hour,
                    required_soldiers=payload.required_soldiers,
                    required_commanders=payload.required_commanders,
                    required_officers=payload.required_officers,
                    required_drivers=payload.required_drivers,
                ).returning(Mission.id)
            ).scalar_one()
            s.commit()
            return {"id": new_id, **payload.model_dump()}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Mission name already exists")


@router.patch("/{mission_id}")
def update_mission(mission_id: int, payload: MissionUpdate):
    if payload.start_hour and payload.end_hour and payload.end_hour <= payload.start_hour:
        raise HTTPException(status_code=400, detail="end_hour must be after start_hour")

    with SessionLocal() as s:
        exists = s.execute(select(Mission.id).where(Mission.id == mission_id)).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="Mission not found")

        values = {k: v for k, v in payload.model_dump().items() if v is not None}
        if not values:
            return {"id": mission_id}

        try:
            s.execute(update(Mission).where(Mission.id == mission_id).values(**values))
            s.commit()
            return {"id": mission_id, **values}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Mission name already exists")


@router.get("/{mission_id}/coverage")
def mission_coverage(
    mission_id: int,
    day: date = Query(..., description="Calendar day in YYYY-MM-DD"),
):
    """
    Returns required/assigned/still_needed for the mission on the given day.
    Counts assigned by canonical bucket (Officer > Commander > Driver > Soldier).
    """
    with SessionLocal() as s:
        mission: Mission | None = s.execute(
            select(Mission).where(Mission.id == mission_id)
        ).scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        # Absolute window for this mission on the given day (supports overnight).
        start_at, end_at = Assignment.window_for(mission.start_hour, mission.end_hour, day)

        # fetch all assignments with soldiers
        rows = s.execute(
            select(Assignment, Soldier)
            .join(Soldier, Soldier.id == Assignment.soldier_id)
            .where(
                Assignment.mission_id == mission.id,
                Assignment.start_at == start_at,
                Assignment.end_at == end_at,
            )
        ).all()

        # Count by canonical bucket
        as_counts = {"Officer": 0, "Commander": 0, "Driver": 0, "Soldier": 0}
        for _a, sol in rows:
            as_counts[_bucket(sol)] += 1

        assigned_officers   = as_counts["Officer"]
        assigned_commanders = as_counts["Commander"]
        assigned_drivers    = as_counts["Driver"]
        assigned_soldiers   = as_counts["Soldier"]

        still = {
            "officers":   max(0, mission.required_officers   - assigned_officers),
            "commanders": max(0, mission.required_commanders - assigned_commanders),
            "drivers":    max(0, mission.required_drivers    - assigned_drivers),
            "soldiers":   max(0, mission.required_soldiers   - assigned_soldiers),
        }

        return {
            "mission": {
                "id": mission.id,
                "name": mission.name,
                "start_at": start_at.isoformat(),
                "end_at": end_at.isoformat(),
            },
            "required": {
                "officers": mission.required_officers,
                "commanders": mission.required_commanders,
                "drivers": mission.required_drivers,
                "soldiers": mission.required_soldiers,
            },
            "assigned": {
                "officers": assigned_officers,
                "commanders": assigned_commanders,
                "drivers": assigned_drivers,
                "soldiers": assigned_soldiers,
            },
            "still_needed": still,
        }

@router.delete("/{mission_id}", status_code=204)
def delete_mission(mission_id: int):
    with SessionLocal() as s:
        # block deletion if any assignments exist for this mission
        has_asg = s.execute(
            select(func.count()).select_from(Assignment).where(Assignment.mission_id == mission_id)
        ).scalar_one()
        if has_asg:
            raise HTTPException(status_code=400, detail="Mission has assignments; clear them first")

        res = s.execute(delete(Mission).where(Mission.id == mission_id))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Mission not found")
        s.commit()
        return None
