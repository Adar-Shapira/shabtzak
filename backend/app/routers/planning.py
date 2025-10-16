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
    q = (
        select(Soldier)
        .join(SoldierRole, SoldierRole.soldier_id == Soldier.id)
        .where(SoldierRole.role_id == role_id)
        .order_by(Soldier.id.asc())
    )
    return [row[0] for row in s.execute(q).all()]


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
    - For each mission slot on the given day:
      - If Mission has role requirements: fill per role counts.
      - Else if Mission.total_needed is set: fill that many with any-role soldiers.
    - Skips soldiers who are on vacation or already overlapping another assignment.
    - Inserts Assignment rows for the computed [start_at, end_at] window.
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
            created_count = 0
            error_msg: str | None = None

            try:
                if not m.slots:
                    results.append(
                        PlanResultItem(mission=mission_brief, created_count=0, error=None)
                    )
                    continue

                for slot in m.slots:
                    start_at, end_at = _mission_window(d, slot.start_time, slot.end_time)

                    if m.requirements:
                        # Fill per-role
                        for req in m.requirements:
                            needed = max(0, int(req.count or 0))
                            if needed == 0:
                                continue

                            eligible = _eligible_soldiers_for_role(s, req.role_id)
                            for soldier in eligible:
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
                                created_count += 1

                    else:
                        # No per-role requirements; fall back to total_needed
                        needed_total = int(m.total_needed or 0)
                        if needed_total <= 0:
                            continue

                        soldiers = s.execute(select(Soldier).order_by(Soldier.id.asc())).scalars().all()
                        for soldier in soldiers:
                            if needed_total == 0:
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
                            needed_total -= 1
                            created_count += 1

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
                PlanResultItem(mission=mission_brief, created_count=created_count, error=error_msg)
            )

    return PlanFillResponse(day=d.isoformat(), results=results)
