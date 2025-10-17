# backend/app/routers/planning.py
from __future__ import annotations

from datetime import datetime, date, timezone, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db import get_db
from app.models.assignment import Assignment
from app.models.mission import Mission
from app.models.mission_slot import MissionSlot
from app.models.mission_requirement import MissionRequirement
from app.models.soldier import Soldier

import os
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo(os.getenv("APP_TZ", "UTC"))
router = APIRouter(prefix="/plan", tags=["planning"])

class FillRequest(BaseModel):
    day: str = Field(..., description="YYYY-MM-DD")
    mission_ids: Optional[List[int]] = None
    replace: bool = False  # if true, clear existing assignments for these missions/day before filling

class PlanResultItem(BaseModel):
    mission: dict
    created_count: int | None = None
    error: str | None = None

class FillResponse(BaseModel):
    day: str
    results: List[PlanResultItem]

def _parse_day(day_str: str) -> date:
    try:
        return date.fromisoformat(day_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid day format; expected YYYY-MM-DD")

def _day_bounds(d: date) -> tuple[datetime, datetime]:
    start_local = datetime(d.year, d.month, d.day, tzinfo=LOCAL_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)

def _load_context(db: Session) -> dict:
    missions: List[Mission] = db.execute(
        select(Mission).options(
            selectinload(Mission.slots),
            selectinload(Mission.requirements),
        )
    ).scalars().all()

    soldiers: List[Soldier] = db.execute(
        select(Soldier).options(selectinload(Soldier.roles))
    ).scalars().all()

    soldiers_by_role: Dict[int, List[Soldier]] = {}
    for s in soldiers:
        for r in s.roles:
            soldiers_by_role.setdefault(r.id, []).append(s)

    return {
        "missions": missions,
        "soldiers_by_role": soldiers_by_role,
        "all_soldiers": soldiers,  # new: pool for generic slots
    }


@router.post("/fill", response_model=FillResponse)
def fill(req: FillRequest, db: Session = Depends(get_db)):
    the_day = _parse_day(req.day)
    day_start, day_end = _day_bounds(the_day)
    ctx = _load_context(db)

    mission_list = ctx["missions"]
    if req.mission_ids:
        wanted = set(req.mission_ids)
        mission_list = [m for m in mission_list if m.id in wanted]

    results: List[PlanResultItem] = []
    rr_index: Dict[Optional[int], int] = {}  # role_id or None

    for m in mission_list:
        try:
            slots: List[MissionSlot] = sorted(m.slots, key=lambda s: (s.start_time, s.end_time))
            reqs: List[MissionRequirement] = m.requirements

            if req.replace:
                db.execute(
                    delete(Assignment).where(
                        and_(
                            Assignment.mission_id == m.id,
                            Assignment.start_at >= day_start,
                            Assignment.start_at < day_end,
                        )
                    )
                )

            if not slots or not reqs:
                results.append(
                    PlanResultItem(mission={"id": m.id, "name": m.name}, created_count=0, error=None)
                )
                continue

            # explicit role demands
            role_demands: List[Optional[int]] = []
            sum_explicit = 0
            for r in reqs:
                if r.count and r.count > 0:
                    role_demands.extend([r.role_id] * r.count)
                    sum_explicit += r.count

            # generic demand (no specific role)
            generic_count = 0
            if getattr(m, "total_needed", None):
                remaining = max(0, int(m.total_needed or 0) - sum_explicit)
                if remaining > 0:
                    generic_count = remaining
                    role_demands.extend([None] * remaining)

            created_here = 0

            for slot in slots:
                start_at, end_at = Assignment.window_for(slot.start_time, slot.end_time, the_day)

                # track who we've already placed in THIS slot/window
                assigned_here: set[int] = set()

                for role_id in role_demands:
                    # decide the pool
                    if role_id is None:
                        pool = ctx["all_soldiers"]
                    else:
                        pool = ctx["soldiers_by_role"].get(role_id, [])

                    if not pool:
                        continue

                    # round-robin starting point for this role (or None)
                    start_idx = rr_index.get(role_id, 0)

                    picked = None
                    # try up to len(pool) candidates to avoid infinite loops
                    for step in range(len(pool)):
                        idx = (start_idx + step) % len(pool)
                        candidate = pool[idx]

                        # skip if already assigned in this same slot
                        if candidate.id in assigned_here:
                            continue

                        # skip if candidate is already busy in the same exact window (any mission)
                        exists = db.execute(
                            select(Assignment)
                            .where(Assignment.soldier_id == candidate.id)
                            .where(Assignment.start_at == start_at)
                            .where(Assignment.end_at == end_at)
                        ).scalars().first()
                        if exists:
                            continue

                        picked = (candidate, idx)
                        break

                    # if no one fit, move on
                    if not picked:
                        continue

                    soldier, used_idx = picked
                    # advance RR cursor to the next after the one we used
                    rr_index[role_id] = (used_idx + 1) % len(pool)

                    # remember this soldier is used for this slot, so we won't pick them again
                    assigned_here.add(soldier.id)

                    a = Assignment(
                        mission_id=m.id,
                        soldier_id=soldier.id,
                        role_id=role_id,  # None for generic slots
                        start_at=start_at,
                        end_at=end_at,
                    )
                    db.add(a)
                    created_here += 1

            results.append(
                PlanResultItem(mission={"id": m.id, "name": m.name}, created_count=created_here, error=None)
            )
        except Exception as ex:
            results.append(
                PlanResultItem(mission={"id": m.id, "name": m.name}, created_count=None, error=str(ex))
            )

    db.commit()
    return FillResponse(day=req.day, results=results)

