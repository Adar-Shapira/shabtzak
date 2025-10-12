from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, delete, insert, select, update
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.soldier import Soldier
from app.models.vacation import Vacation

import os

# -----------------------------
# Config
# -----------------------------
DEFAULT_COOLDOWN_HOURS = int(os.getenv("ASSIGNMENT_COOLDOWN_HOURS", "8"))
FAIRNESS_WINDOW_DAYS = int(os.getenv("ASSIGNMENT_FAIRNESS_DAYS", "14"))

router = APIRouter(prefix="/assignments", tags=["assignments"])


# -----------------------------
# Role helpers (many-to-many)
# -----------------------------
def _has_named_role(sol: Soldier, role_name: str) -> bool:
    """True if soldier has a role with this exact name."""
    try:
        return any(r.name == role_name for r in (sol.roles or []))
    except Exception:
        return False


def _bucket(sol: Soldier) -> str:
    """Canonical bucket used for coverage and display."""
    for name in ("Officer", "Commander", "Driver"):
        if _has_named_role(sol, name):
            return name
    return "Soldier"


# -----------------------------
# Constraints
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
    """Any assignment overlapping the [start_at, end_at) window."""
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
    """Require at least cooldown_hours before and after the window relative to existing assignments."""
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
    """
    Treat soldier.restrictions as comma/semicolon tokens.
    If any token equals the mission name (case-insensitive), block.
    """
    toks = [t.strip().lower() for t in (sol.restrictions or "").replace(";", ",").split(",") if t.strip()]
    return mission_name.strip().lower() in set(toks)


# -----------------------------
# Schemas
# -----------------------------
class AssignIn(BaseModel):
    mission_id: int
    soldier_id: int
    day: date  # calendar day the mission starts

    @field_validator("day")
    @classmethod
    def _ensure_date(cls, v: date) -> date:
        return v


class ClearIn(BaseModel):
    mission_id: int
    day: date


# -----------------------------
# Endpoints
# -----------------------------
@router.get("")
def list_assignments():
    with SessionLocal() as s:
        rows = (
            s.execute(select(Assignment).order_by(Assignment.start_at))
            .scalars()
            .all()
        )
        out = []
        for a in rows:
            out.append(
                {
                    "id": a.id,
                    "mission_id": a.mission_id,
                    "soldier_id": a.soldier_id,
                    "soldier_name": a.soldier.name if a.soldier else None,
                    "mission_name": a.mission.name if a.mission else None,
                    "start_at": a.start_at.isoformat(),
                    "end_at": a.end_at.isoformat(),
                }
            )
        return out


@router.post("", status_code=201)
def create_assignment(payload: AssignIn):
    with SessionLocal() as s:
        mission = s.execute(select(Mission).where(Mission.id == payload.mission_id)).scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        soldier = s.execute(select(Soldier).where(Soldier.id == payload.soldier_id)).scalar_one_or_none()
        if not soldier:
            raise HTTPException(status_code=404, detail="Soldier not found")

        start_at, end_at = Assignment.window_for(mission.start_hour, mission.end_hour, payload.day)

        # Hard checks
        if _on_vacation(s, soldier.id, payload.day):
            raise HTTPException(status_code=400, detail="Soldier is on vacation on that day")
        if _has_overlap_conflict(s, soldier.id, start_at, end_at):
            raise HTTPException(status_code=400, detail="Overlapping assignment")
        if _has_cooldown_conflict(s, soldier.id, start_at, end_at):
            raise HTTPException(status_code=400, detail="Cooldown conflict")
        if _blocked_for_mission(soldier, mission.name):
            raise HTTPException(status_code=400, detail="Soldier is restricted from this mission")

        try:
            new_id = (
                s.execute(
                    insert(Assignment)
                    .values(
                        mission_id=mission.id,
                        soldier_id=soldier.id,
                        start_at=start_at,
                        end_at=end_at,
                    )
                    .returning(Assignment.id)
                ).scalar_one()
            )
            s.commit()
            return {"id": new_id, "mission_id": mission.id, "soldier_id": soldier.id, "start_at": start_at, "end_at": end_at}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Duplicate assignment window for soldier")


@router.delete("/{assignment_id}", status_code=204)
def delete_assignment(assignment_id: int):
    with SessionLocal() as s:
        res = s.execute(delete(Assignment).where(Assignment.id == assignment_id))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Assignment not found")
        s.commit()
        return None


@router.post("/clear")
def clear_assignments(payload: ClearIn):
    with SessionLocal() as s:
        mission = s.execute(select(Mission).where(Mission.id == payload.mission_id)).scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        start_at, end_at = Assignment.window_for(mission.start_hour, mission.end_hour, payload.day)
        res = s.execute(
            delete(Assignment).where(
                and_(
                    Assignment.mission_id == mission.id,
                    Assignment.start_at == start_at,
                    Assignment.end_at == end_at,
                )
            )
        )
        s.commit()
        return {"deleted": res.rowcount or 0}


@router.get("/roster")
def roster(mission_id: int = Query(...), day: date = Query(...)):
    """
    Return the roster for a mission on a given day, including 'still_needed' by bucket.
    """
    with SessionLocal() as s:
        mission = s.execute(select(Mission).where(Mission.id == mission_id)).scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        start_at, end_at = Assignment.window_for(mission.start_hour, mission.end_hour, day)

        rows = (
            s.execute(
                select(Assignment)
                .where(
                    and_(
                        Assignment.mission_id == mission.id,
                        Assignment.start_at == start_at,
                        Assignment.end_at == end_at,
                    )
                )
                .order_by(Assignment.id)
            )
            .scalars()
            .all()
        )

        # Build assigned list + counts
        assigned: List[Dict] = []
        counts = {"Officer": 0, "Commander": 0, "Driver": 0, "Soldier": 0}

        for a in rows:
            sol = a.soldier  # relationship
            role_bucket = _bucket(sol)
            counts[role_bucket] += 1
            assigned.append(
                {
                    "id": a.id,
                    "soldier_id": a.soldier_id,
                    "name": sol.name if sol else None,
                    "role": role_bucket,
                }
            )

        still = {
            "officers": max(0, mission.required_officers - counts["Officer"]),
            "commanders": max(0, mission.required_commanders - counts["Commander"]),
            "drivers": max(0, mission.required_drivers - counts["Driver"]),
            "soldiers": max(0, mission.required_soldiers - counts["Soldier"]),
        }

        return {
            "mission": {
                "id": mission.id,
                "name": mission.name,
                "start_at": start_at.isoformat(),
                "end_at": end_at.isoformat(),
            },
            "assigned": assigned,
            "still_needed": still,
        }


@router.get("/available")
def available(mission_id: int = Query(...), day: date = Query(...), debug: int = Query(0)):
    """
    List soldiers available to be assigned to this mission window.
    Applies vacation, overlap, cooldown, and mission restriction filters.
    Returns `available: [{id, name, role}]` and (if debug=1) `skipped: [{id, name, reason}]`.
    """
    with SessionLocal() as s:
        mission = s.execute(select(Mission).where(Mission.id == mission_id)).scalar_one_or_none()
        if not mission:
            raise HTTPException(status_code=404, detail="Mission not found")

        start_at, end_at = Assignment.window_for(mission.start_hour, mission.end_hour, day)

        # Load all soldiers (roles are loaded via relationship on demand)
        soldiers: List[Soldier] = s.execute(select(Soldier).order_by(Soldier.id)).scalars().all()

        out: List[Dict] = []
        skipped: List[Dict] = []

        for sol in soldiers:
            # vacation?
            if _on_vacation(s, sol.id, day):
                if debug:
                    skipped.append({"id": sol.id, "name": sol.name, "reason": "vacation"})
                continue
            # overlap?
            if _has_overlap_conflict(s, sol.id, start_at, end_at):
                if debug:
                    skipped.append({"id": sol.id, "name": sol.name, "reason": "overlap"})
                continue
            # cooldown?
            if _has_cooldown_conflict(s, sol.id, start_at, end_at):
                if debug:
                    skipped.append({"id": sol.id, "name": sol.name, "reason": "cooldown"})
                continue
            # restricted by mission token?
            if _blocked_for_mission(sol, mission.name):
                if debug:
                    skipped.append({"id": sol.id, "name": sol.name, "reason": "restricted"})
                continue

            out.append(
                {
                    "id": sol.id,
                    "name": sol.name,
                    "role": _bucket(sol),
                }
            )

        # Fairness: prefer fewer recent assignments
        out.sort(key=lambda rec: (_recent_assignments_count(s, rec["id"], start_at), rec["id"]))

        resp = {"available": out}
        if debug:
            resp["skipped"] = skipped
        return resp
