# backend/app/routers/planning.py
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, select, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.db import SessionLocal
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.mission_slot import MissionSlot
from app.models.mission_requirement import MissionRequirement
from app.models.soldier import Soldier
from app.models.soldier_role import SoldierRole
from app.models.vacation import Vacation

router = APIRouter(prefix="/plan", tags=["planner"])


# ---------- Helpers -----------------------------------------------------------

def _mission_window(day: date, start: time, end: time) -> tuple[datetime, datetime]:
    start_dt = datetime.combine(day, start).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(day, end).replace(tzinfo=timezone.utc)
    if end_dt <= start_dt:
        end_dt += timedelta(days=1)  # overnight
    return start_dt, end_dt


def _soldier_on_vacation(s, soldier_id: int, d: date) -> bool:
    q = (
        select(Vacation.id)
        .where(
            and_(
                Vacation.soldier_id == soldier_id,
                Vacation.start_date <= d,
                Vacation.end_date >= d,
            )
        )
        .limit(1)
    )
    return s.execute(q).first() is not None


def _overlaps_assignment(s, soldier_id: int, start_at: datetime, end_at: datetime) -> bool:
    q = (
        select(Assignment.id)
        .where(
            and_(
                Assignment.soldier_id == soldier_id,
                Assignment.end_at > start_at,
                Assignment.start_at < end_at,
            )
        )
        .limit(1)
    )
    return s.execute(q).first() is not None


def _eligible_soldiers_for_role(s, role_id: int) -> List[Soldier]:
    # All soldiers that have the specific role
    q = (
        select(Soldier)
        .join(SoldierRole, SoldierRole.soldier_id == Soldier.id)
        .where(SoldierRole.role_id == role_id)
        .order_by(Soldier.id.asc())
    )
    return [row[0] for row in s.execute(q).all()]


def _all_soldiers(s) -> List[Soldier]:
    return s.execute(select(Soldier).order_by(Soldier.id.asc())).scalars().all()


# ---------- Payload / Response models ----------------------------------------

class MissionBrief(BaseModel):
    id: int
    name: str


class PlanFillPayload(BaseModel):
    day: date

    @field_validator("day")
    @classmethod
    def _validate_day(cls, v: date) -> date:
        return v


class PlanResultItem(BaseModel):
    mission: MissionBrief
    created_count: int | None = None
    error: str | None = None


class PlanFillResponse(BaseModel):
    day: str
    results: List[PlanResultItem]


# ---------- POST /plan/fill ---------------------------------------------------

@router.post("/fill", response_model=PlanFillResponse)
def fill_plan(payload: PlanFillPayload):
    """
    Greedy planner:

    For each mission and each of its slots on the given day:
      1) Satisfy per-role requirements (minimums).
      2) If mission.total_needed is set, fill any remaining headcount for that slot
         with *any* available soldier (with or without roles) until total_needed is reached.
    Always skip soldiers who are on vacation or already overlapping another assignment.
    """
    d = payload.day
    results: List[PlanResultItem] = []

    with SessionLocal() as s:
        missions = (
            s.query(Mission)
            .options(joinedload(Mission.slots), joinedload(Mission.requirements))
            .order_by(Mission.id.asc())
            .all()
        )

        for m in missions:
            mission_brief = MissionBrief(id=m.id, name=(m.name or f"Mission {m.id}"))
            created_total_for_mission = 0
            error_msg: str | None = None

            try:
                if not m.slots:
                    results.append(
                        PlanResultItem(mission=mission_brief, created_count=0, error=None)
                    )
                    continue

                for slot in m.slots:
                    start_at, end_at = _mission_window(d, slot.start_time, slot.end_time)

                    # Track how many we assign for THIS slot (used for "remainder" calc).
                    created_for_slot = 0

                    # --- Step 1: per-role minimums
                    if m.requirements:
                        for req in m.requirements:
                            needed = max(0, int(req.count or 0))
                            if needed == 0:
                                continue

                            for soldier in _eligible_soldiers_for_role(s, req.role_id):
                                if needed == 0:
                                    break
                                if _soldier_on_vacation(s, soldier.id, d):
                                    continue
                                if _overlaps_assignment(s, soldier.id, start_at, end_at):
                                    continue

                                s.execute(
                                    insert(Assignment).values(
                                        mission_id=m.id,
                                        soldier_id=soldier.id,
                                        start_at=start_at,
                                        end_at=end_at,
                                        created_at=datetime.now(timezone.utc),
                                    )
                                )
                                needed -= 1
                                created_for_slot += 1
                                created_total_for_mission += 1

                    # --- Step 2: remainder up to total_needed (any soldier)
                    total_needed = int(m.total_needed or 0)
                    if total_needed > 0:
                        remainder = max(0, total_needed - created_for_slot)
                        if remainder > 0:
                            for soldier in _all_soldiers(s):
                                if remainder == 0:
                                    break
                                if _soldier_on_vacation(s, soldier.id, d):
                                    continue
                                if _overlaps_assignment(s, soldier.id, start_at, end_at):
                                    continue

                                s.execute(
                                    insert(Assignment).values(
                                        mission_id=m.id,
                                        soldier_id=soldier.id,
                                        start_at=start_at,
                                        end_at=end_at,
                                        created_at=datetime.now(timezone.utc),
                                    )
                                )
                                remainder -= 1
                                created_for_slot += 1
                                created_total_for_mission += 1

                s.commit()

            except IntegrityError:
                s.rollback()
                error_msg = "Duplicate assignment blocked by DB constraints"
            except HTTPException as he:
                s.rollback()
                error_msg = str(he.detail)
            except Exception as e:
                s.rollback()
                error_msg = f"Planner failure: {e}"

            results.append(
                PlanResultItem(
                    mission=mission_brief,
                    created_count=created_total_for_mission,
                    error=error_msg,
                )
            )

    return PlanFillResponse(day=d.isoformat(), results=results)
