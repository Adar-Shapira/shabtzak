from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, insert, select, delete
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.soldier import Soldier
from app.models.vacation import Vacation

import os

router = APIRouter(prefix="/plan", tags=["planning"])

# Config
DEFAULT_COOLDOWN_HOURS = int(os.getenv("ASSIGNMENT_COOLDOWN_HOURS", "8"))
FAIRNESS_WINDOW_DAYS = int(os.getenv("ASSIGNMENT_FAIRNESS_DAYS", "14"))


# -----------------------------
# Role helpers (many-to-many)
# -----------------------------
def _has_named_role(sol: Soldier, role_name: str) -> bool:
    try:
        return any(r.name == role_name for r in (sol.roles or []))
    except Exception:
        return False


def _bucket(sol: Soldier) -> str:
    # Priority buckets for counting/labels
    for name in ("Officer", "Commander", "Driver"):
        if _has_named_role(sol, name):
            return name
    return "Soldier"


# -----------------------------
# Filters & constraints
# -----------------------------
def _recent_assignments_count(s, soldier_id: int, ref_start: datetime, hours_back: int = FAIRNESS_WINDOW_DAYS * 24) -> int:
    window_start = ref_start - timedelta(hours=hours_back)
    q = (
        select(Assignment.id)
        .where(
            and_(
                Assignment.soldier_id == soldier_id,
                Assignment.end_at > window_start,
                Assignment.start_at < ref_start,
            )
        )
    )
    return len(s.execute(q).all())


def _has_overlap_conflict(s, soldier_id: int, start_at: datetime, end_at: datetime) -> bool:
    q = (
        select(Assignment.id)
        .where(
            and_(
                Assignment.soldier_id == soldier_id,
                Assignment.start_at < end_at,
                Assignment.end_at > start_at,
            )
        )
        .limit(1)
    )
    return s.execute(q).first() is not None


def _has_cooldown_conflict(s, soldier_id: int, start_at: datetime, end_at: datetime, cooldown_hours: int = DEFAULT_COOLDOWN_HOURS) -> bool:
    before_q = (
        select(Assignment.end_at)
        .where(
            and_(
                Assignment.soldier_id == soldier_id,
                Assignment.end_at <= start_at,
                Assignment.end_at > start_at - timedelta(hours=cooldown_hours),
            )
        )
        .limit(1)
    )
    after_q = (
        select(Assignment.start_at)
        .where(
            and_(
                Assignment.soldier_id == soldier_id,
                Assignment.start_at >= end_at,
                Assignment.start_at < end_at + timedelta(hours=cooldown_hours),
            )
        )
        .limit(1)
    )
    return (s.execute(before_q).first() is not None) or (s.execute(after_q).first() is not None)


def _on_vacation(s, soldier_id: int, day: date) -> bool:
    q = (
        select(Vacation.id)
        .where(
            and_(
                Vacation.soldier_id == soldier_id,
                Vacation.start_date <= day,
                Vacation.end_date >= day,
            )
        )
        .limit(1)
    )
    return s.execute(q).first() is not None


def _blocked_for_mission(sol: Soldier, mission_name: str) -> bool:
    toks = [t.strip().lower() for t in (sol.restrictions or "").replace(";", ",").split(",") if t.strip()]
    return mission_name.strip().lower() in set(toks)


# -----------------------------
# Schema
# -----------------------------
class PlanFillIn(BaseModel):
    day: date
    accept_partial: bool = True
    max_per_mission: Optional[int] = None

    @field_validator("day")
    @classmethod
    def _valid_date(cls, v: date) -> date:
        return v


# -----------------------------
# Planner
# -----------------------------
@router.post("/fill")
def fill_day(payload: PlanFillIn):
    """
    Attempts to fill all missions on a given day.
    - Honors vacations, overlaps, cooldown, and mission restrictions.
    - Fills by role order: Officers -> Commanders -> Drivers -> Soldiers.
    - Fairness: prefers fewer recent assignments (over a rolling window).
    - If accept_partial=False and a mission cannot be fully satisfied, created
      assignments for that mission are rolled back and an error is returned for it.
    - max_per_mission limits the count of *new* assignments created for a mission.
    """
    results: List[Dict] = []
    with SessionLocal() as s:
        missions: List[Mission] = s.execute(select(Mission).order_by(Mission.id)).scalars().all()
        soldiers: List[Soldier] = s.execute(select(Soldier).order_by(Soldier.id)).scalars().all()

        for mission in missions:
            mission_res: Dict = {"mission": {"id": mission.id, "name": mission.name}}
            created_ids: List[int] = []
            try:
                start_at, end_at = Assignment.window_for(mission.start_hour, mission.end_hour, payload.day)

                # Count already assigned in this window
                existing_rows = s.execute(
                    select(Assignment, Soldier)
                    .join(Soldier, Soldier.id == Assignment.soldier_id)
                    .where(
                        Assignment.mission_id == mission.id,
                        Assignment.start_at == start_at,
                        Assignment.end_at == end_at,
                    )
                ).all()
                already_assigned_soldier_ids = {a.soldier_id for a, _sol in existing_rows}

                # Current assigned counts by bucket
                counts = {"Officer": 0, "Commander": 0, "Driver": 0, "Soldier": 0}
                for _a, sol in existing_rows:
                    counts[_bucket(sol)] += 1

                # Build an "eligible pool" once (passes hard constraints)
                eligible: List[Soldier] = []
                for sol in soldiers:
                    if sol.id in already_assigned_soldier_ids:
                        continue
                    if _on_vacation(s, sol.id, payload.day):
                        continue
                    if _has_overlap_conflict(s, sol.id, start_at, end_at):
                        continue
                    if _has_cooldown_conflict(s, sol.id, start_at, end_at):
                        continue
                    if _blocked_for_mission(sol, mission.name):
                        continue
                    eligible.append(sol)

                # Fairness pre-score
                fairness_score = {
                    sol.id: _recent_assignments_count(s, sol.id, start_at) for sol in eligible
                }

                def pick(cands: List[Soldier], need: int) -> List[Soldier]:
                    if need <= 0:
                        return []
                    # sort by (fairness, id)
                    cands_sorted = sorted(cands, key=lambda u: (fairness_score.get(u.id, 0), u.id))
                    return cands_sorted[:need]

                created_count = 0

                # 1) Officers
                need = max(0, mission.required_officers - counts["Officer"])
                cands = [u for u in eligible if _has_named_role(u, "Officer")]
                chosen = pick(cands, need)
                for sol in chosen:
                    new_id = s.execute(
                        insert(Assignment)
                        .values(mission_id=mission.id, soldier_id=sol.id, start_at=start_at, end_at=end_at)
                        .returning(Assignment.id)
                    ).scalar_one()
                    created_ids.append(new_id)
                    created_count += 1
                    counts["Officer"] += 1
                    eligible.remove(sol)

                # 2) Commanders
                need = max(0, mission.required_commanders - counts["Commander"])
                cands = [u for u in eligible if _has_named_role(u, "Commander")]
                chosen = pick(cands, need)
                for sol in chosen:
                    new_id = s.execute(
                        insert(Assignment)
                        .values(mission_id=mission.id, soldier_id=sol.id, start_at=start_at, end_at=end_at)
                        .returning(Assignment.id)
                    ).scalar_one()
                    created_ids.append(new_id)
                    created_count += 1
                    counts["Commander"] += 1
                    eligible.remove(sol)

                # 3) Drivers
                need = max(0, mission.required_drivers - counts["Driver"])
                cands = [u for u in eligible if _has_named_role(u, "Driver")]
                chosen = pick(cands, need)
                for sol in chosen:
                    new_id = s.execute(
                        insert(Assignment)
                        .values(mission_id=mission.id, soldier_id=sol.id, start_at=start_at, end_at=end_at)
                        .returning(Assignment.id)
                    ).scalar_one()
                    created_ids.append(new_id)
                    created_count += 1
                    counts["Driver"] += 1
                    eligible.remove(sol)

                # 4) Soldiers (any remaining eligible)
                need = max(0, mission.required_soldiers - counts["Soldier"])
                cands = list(eligible)
                chosen = pick(cands, need)
                for sol in chosen:
                    new_id = s.execute(
                        insert(Assignment)
                        .values(mission_id=mission.id, soldier_id=sol.id, start_at=start_at, end_at=end_at)
                        .returning(Assignment.id)
                    ).scalar_one()
                    created_ids.append(new_id)
                    created_count += 1
                    counts["Soldier"] += 1
                    eligible.remove(sol)

                # Honor max_per_mission (cap *newly created*)
                if payload.max_per_mission is not None and created_count > payload.max_per_mission:
                    # delete the excess newest first
                    to_delete = created_ids[payload.max_per_mission :]
                    if to_delete:
                        s.execute(delete(Assignment).where(Assignment.id.in_(to_delete)))
                        created_count = payload.max_per_mission
                        created_ids = created_ids[:payload.max_per_mission]

                # If we didn't fully satisfy and we don't accept partial — rollback this mission
                fully_satisfied = (
                    counts["Officer"]   >= mission.required_officers and
                    counts["Commander"] >= mission.required_commanders and
                    counts["Driver"]    >= mission.required_drivers and
                    counts["Soldier"]   >= mission.required_soldiers
                )
                if not fully_satisfied and not payload.accept_partial:
                    if created_ids:
                        s.execute(delete(Assignment).where(Assignment.id.in_(created_ids)))
                        created_count = 0
                        created_ids.clear()
                    mission_res["error"] = "Insufficient eligible personnel to fully cover requirements"
                else:
                    mission_res["created_count"] = created_count

                s.commit()

            except IntegrityError:
                s.rollback()
                mission_res["error"] = "Duplicate assignment(s) blocked by constraints"
            except HTTPException as he:
                s.rollback()
                mission_res["error"] = he.detail
            except Exception as e:
                s.rollback()
                mission_res["error"] = f"Planner failure: {e}"

            results.append(mission_res)

    return {"day": payload.day.isoformat(), "results": results}
