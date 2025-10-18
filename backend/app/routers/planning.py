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
from app.models.soldier_mission_restriction import SoldierMissionRestriction
from app.models.vacation import Vacation


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

def _vacation_blocks_for_day(db: Session, the_day: date) -> Dict[int, List[tuple[datetime, datetime]]]:
    """
    Build, in LOCAL_TZ, the 'blocked' time windows for each soldier on `the_day`,
    then convert to UTC. Rules:
      - If the_day is strictly between start_date and end_date: block 00:00–24:00.
      - If the_day == start_date and the_day < end_date: block 14:00–24:00.
      - If the_day == end_date and the_day > start_date: block 00:00–14:00.
      - If start_date == end_date == the_day: block the whole day (00:00–24:00).
    """
    blocks: Dict[int, List[tuple[datetime, datetime]]] = {}

    # Fetch only vacations that touch this day
    vacs = db.execute(
        select(Vacation).where(
            and_(
                Vacation.start_date <= the_day,
                Vacation.end_date >= the_day,
            )
        )
    ).scalars().all()

    day_start_local = datetime(the_day.year, the_day.month, the_day.day, 0, 0, 0, tzinfo=LOCAL_TZ)
    day_end_local = day_start_local + timedelta(days=1)

    for v in vacs:
        s_id = v.soldier_id
        # Determine which pattern applies
        if v.start_date < the_day < v.end_date:
            block_start_local = day_start_local
            block_end_local = day_end_local
            blocks.setdefault(s_id, []).append(
                (block_start_local.astimezone(timezone.utc), block_end_local.astimezone(timezone.utc))
            )
        elif v.start_date == the_day == v.end_date:
            # Single-day vacation → treat as fully blocked (00–24)
            block_start_local = day_start_local
            block_end_local = day_end_local
            blocks.setdefault(s_id, []).append(
                (block_start_local.astimezone(timezone.utc), block_end_local.astimezone(timezone.utc))
            )
        elif v.start_date == the_day and v.end_date > the_day:
            block_start_local = day_start_local.replace(hour=14, minute=0, second=0, microsecond=0)
            block_end_local = day_end_local
            blocks.setdefault(s_id, []).append(
                (block_start_local.astimezone(timezone.utc), block_end_local.astimezone(timezone.utc))
            )
        elif v.end_date == the_day and v.start_date < the_day:
            block_start_local = day_start_local
            block_end_local = day_start_local.replace(hour=14, minute=0, second=0, microsecond=0)
            blocks.setdefault(s_id, []).append(
                (block_start_local.astimezone(timezone.utc), block_end_local.astimezone(timezone.utc))
            )
        # All other cases do not create a block on this specific day

    return blocks

def _overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return (a_start < b_end) and (a_end > b_start)

def _has_8h_rest_around(
    occupied: List[tuple[datetime, datetime]],
    cand_start: datetime,
    cand_end: datetime,
    min_gap: timedelta,
) -> bool:
    """
    Return True if BOTH gaps are satisfied:
      - previous_end -> cand_start >= min_gap
      - cand_end -> next_start >= min_gap
    Only checks the nearest neighbors among `occupied`. Does NOT consider overlaps
    (you already block overlaps separately).
    """
    if not occupied:
        return True

    prev_end = None
    next_start = None

    for s, e in occupied:
        if e <= cand_start and (prev_end is None or e > prev_end):
            prev_end = e
        if s >= cand_end and (next_start is None or s < next_start):
            next_start = s

    ok_prev = True if prev_end is None else (cand_start - prev_end) >= min_gap
    ok_next = True if next_start is None else (next_start - cand_end) >= min_gap
    return ok_prev and ok_next


# -------- Fairness/Rotation configuration --------
FAIRNESS_WINDOW_DAYS = 14  # look back this many days for rotation/workload stats
EIGHT_HOURS = timedelta(hours=8)

# We minimize this score (lower = more preferred).
# Tweak weights to taste; all are >= 0.
WEIGHTS = {
    "recent_gap_penalty_per_hour_missing": 2.0,    # penalty per hour when rest gap < 8h
    "same_mission_recent_penalty": 5.0,            # flat penalty if soldier did this mission in the lookback window
    "mission_repeat_count_penalty": 1.0,           # per-count penalty for how many times soldier did this mission in window
    "today_assignment_count_penalty": 2.0,         # per assignment already today
    "total_hours_window_penalty_per_hour": 0.05,   # mild penalty per worked hour in lookback window
    "recent_gap_boost_per_hour": -0.1,             # small negative penalty (boost) per hour of rest beyond 8h
}

class SoldierStats:
    __slots__ = (
        "last_end_at",             # datetime | None
        "today_count",             # int
        "total_hours_window",      # float hours
        "mission_count",           # Dict[int, int]
        "recent_missions",         # set[int]
    )
    def __init__(self):
        self.last_end_at = None
        self.today_count = 0
        self.total_hours_window = 0.0
        self.mission_count = {}
        self.recent_missions = set()

def _fetch_recent_assignments(db: Session, day_start: datetime, day_end: datetime) -> List[Assignment]:
    window_start = day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)
    # Bring assignments from [window_start, day_end) to compute stats
    return db.execute(
        select(Assignment)
        .where(Assignment.end_at > window_start)
        .where(Assignment.start_at < day_end)
    ).scalars().all()

def _build_soldier_stats(recent: List[Assignment], day_start: datetime, day_end: datetime) -> Dict[int, SoldierStats]:
    stats: Dict[int, SoldierStats] = {}
    for a in recent:
        s_id = a.soldier_id
        st = stats.setdefault(s_id, SoldierStats())

        # last_end_at: keep the latest assignment end strictly before day_start
        if a.end_at <= day_start:
            if st.last_end_at is None or a.end_at > st.last_end_at:
                st.last_end_at = a.end_at

        # today_count: count assignments that overlap the selected day
        if not (a.end_at <= day_start or a.start_at >= day_end):
            # overlaps the day window → counts as "today"
            st.today_count += 1

        # total hours in lookback window
        # intersect assignment with [day_start - window, day_end] for fair hours rounding
        window_start = day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)
        seg_start = max(a.start_at, window_start)
        seg_end = min(a.end_at, day_end)
        if seg_end > seg_start:
            st.total_hours_window += (seg_end - seg_start).total_seconds() / 3600.0

        # mission rotation stats in lookback window
        if a.start_at < day_end and a.end_at > (day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)):
            st.mission_count[a.mission_id] = st.mission_count.get(a.mission_id, 0) + 1
            st.recent_missions.add(a.mission_id)

    return stats

def _score_candidate(
    soldier: Soldier,
    mission_id: int,
    start_at: datetime,
    end_at: datetime,
    st: SoldierStats,
) -> float:
    score = 0.0

    # 1) Rest maximization: prefer larger gap; penalize gaps under 8h
    # If no last_end_at, treat as well-rested (small boost from duration itself).
    if st.last_end_at is not None:
        gap = start_at - st.last_end_at
        if gap < timedelta(0):
            # Overlap with candidate's last assignment (should be filtered elsewhere),
            # but if reached here, punish heavily.
            missing_hours = abs(gap.total_seconds()) / 3600.0
            score += WEIGHTS["recent_gap_penalty_per_hour_missing"] * (8.0 + missing_hours)
        elif gap < EIGHT_HOURS:
            missing = (EIGHT_HOURS - gap).total_seconds() / 3600.0
            score += WEIGHTS["recent_gap_penalty_per_hour_missing"] * missing
        else:
            extra = (gap - EIGHT_HOURS).total_seconds() / 3600.0
            score += WEIGHTS["recent_gap_boost_per_hour"] * extra
    else:
        # No recent work → tiny preference (negative penalty)
        score += WEIGHTS["recent_gap_boost_per_hour"] * 4.0

    # 2) Rotation: avoid repeating same mission
    if mission_id in st.recent_missions:
        score += WEIGHTS["same_mission_recent_penalty"]
        count = st.mission_count.get(mission_id, 0)
        score += WEIGHTS["mission_repeat_count_penalty"] * float(count)

    # 3) Balance intra-day load
    score += WEIGHTS["today_assignment_count_penalty"] * float(st.today_count)

    # 4) Balance recent workload
    score += WEIGHTS["total_hours_window_penalty_per_hour"] * float(st.total_hours_window)

    # 5) Prefer longer rest before long shifts a bit more (optional small nudge)
    duration_hours = (end_at - start_at).total_seconds() / 3600.0
    score += 0.0 * duration_hours

    return score

def _update_stats_after_assignment(st: SoldierStats, mission_id: int, start_at: datetime, end_at: datetime, day_start: datetime, day_end: datetime):
    # Update soldier stats in-memory after we place an assignment, so next picks are fair
    if end_at <= day_start:
        if st.last_end_at is None or end_at > st.last_end_at:
            st.last_end_at = end_at
    elif start_at < day_start and end_at > day_start:
        # crossing into day → last_end_at remains the latest before day_start
        pass
    else:
        # assignment inside or after day_start
        if st.last_end_at is None or end_at > st.last_end_at:
            st.last_end_at = end_at

    # Today count increments if overlaps today
    if not (end_at <= day_start or start_at >= day_end):
        st.today_count += 1

    # Hours window (bounded)
    window_start = day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)
    seg_start = max(start_at, window_start)
    seg_end = min(end_at, day_end)
    if seg_end > seg_start:
        st.total_hours_window += (seg_end - seg_start).total_seconds() / 3600.0

    # Mission rotation
    st.recent_missions.add(mission_id)
    st.mission_count[mission_id] = st.mission_count.get(mission_id, 0) + 1


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
    vacation_blocks = _vacation_blocks_for_day(db, the_day)
    recent_assignments = _fetch_recent_assignments(db, day_start, day_end)
    stats_by_soldier = _build_soldier_stats(recent_assignments, day_start, day_end)

    # Exact-window duplicates that already exist today
    existing_same_window: set[tuple[int, datetime, datetime]] = set(
        db.execute(
            select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
            .where(Assignment.start_at < day_end)
            .where(Assignment.end_at > day_start)
        ).all()
    )

    # Per-soldier occupied intervals that touch the day (for general overlap checks)
    occupied_by_soldier: Dict[int, List[tuple[datetime, datetime]]] = {}
    for sid, s_at, e_at in db.execute(
        select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
        .where(Assignment.start_at < day_end)
        .where(Assignment.end_at > day_start)
    ).all():
        occupied_by_soldier.setdefault(sid, []).append((s_at, e_at))

    # (Optional but recommended) Restrictions lookup
    restricted_pairs: set[tuple[int, int]] = set(
        db.execute(
            select(SoldierMissionRestriction.soldier_id, SoldierMissionRestriction.mission_id)
        ).all()
    )

    mission_list = ctx["missions"]
    if req.mission_ids:
        wanted = set(req.mission_ids)
        mission_list = [m for m in mission_list if m.id in wanted]

    results: List[PlanResultItem] = []
    rr_index: Dict[Optional[int], int] = {}  # role_id or None

    # One-shot clear (so in-memory lookups reflect the actual DB state)
    if req.replace:
        ids_to_clear = [mm.id for mm in mission_list]
        if ids_to_clear:
            db.execute(
                delete(Assignment).where(
                    and_(
                        Assignment.mission_id.in_(ids_to_clear),
                        Assignment.start_at >= day_start,
                        Assignment.start_at < day_end,
                    )
                )
            )
            # Rebuild lookups from DB after delete
            existing_same_window = set(
                db.execute(
                    select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
                    .where(Assignment.start_at < day_end)
                    .where(Assignment.end_at > day_start)
                ).all()
            )
            occupied_by_soldier.clear()
            for sid, s_at, e_at in db.execute(
                select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
                .where(Assignment.start_at < day_end)
                .where(Assignment.end_at > day_start)
            ).all():
                occupied_by_soldier.setdefault(sid, []).append((s_at, e_at))                                                                                                                            

    for m in mission_list:
        try:
            slots: List[MissionSlot] = sorted(m.slots, key=lambda s: (s.start_time, s.end_time))
            reqs: List[MissionRequirement] = m.requirements

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

                    # Build scored candidate list for this specific slot
                    # We minimize score; tie-break by prior round-robin cursor.
                    scored: List[tuple[float, int, Soldier]] = []
                    for i, cand in enumerate(pool):
                        if cand.id in assigned_here:
                            continue

                        # vacation block check (precomputed)
                        blocked_list = vacation_blocks.get(cand.id, [])
                        is_blocked = any(bs_utc < end_at and be_utc > start_at for bs_utc, be_utc in blocked_list)
                        if is_blocked:
                            continue

                        # mission restriction
                        if (cand.id, m.id) in restricted_pairs:
                            continue

                        # identical window conflict
                        if (cand.id, start_at, end_at) in existing_same_window:
                            continue

                        # general overlap against any of this soldier's occupied intervals
                        if any(_overlaps(start_at, end_at, occ_s, occ_e) for (occ_s, occ_e) in occupied_by_soldier.get(cand.id, [])):
                            continue

                        # hard 8h rest floor (avoid REST warnings)
                        st = stats_by_soldier.setdefault(cand.id, SoldierStats())
                        if st.last_end_at is not None:
                            if (start_at - st.last_end_at) < EIGHT_HOURS:
                                continue

                        # also require 8h before and after relative to already-occupied intervals
                        occ_list = occupied_by_soldier.get(cand.id, [])
                        if not _has_8h_rest_around(occ_list, start_at, end_at, EIGHT_HOURS):
                            continue


                        # score and tie-break with round-robin cursor
                        base_score = _score_candidate(cand, m.id, start_at, end_at, st)
                        start_idx = rr_index.get(role_id, 0)
                        rr_distance = (i - start_idx) % max(1, len(pool))
                        score = base_score + rr_distance * 0.001

                        scored.append((score, i, cand))

                    # choose the lowest-score candidate
                    if not scored:
                        continue
                    scored.sort(key=lambda t: (t[0], t[1]))
                    chosen_score, chosen_i, soldier = scored[0]

                    # advance RR cursor to next after chosen_i for this role
                    rr_index[role_id] = (chosen_i + 1) % max(1, len(pool))


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

                    existing_same_window.add((soldier.id, start_at, end_at))
                    occupied_by_soldier.setdefault(soldier.id, []).append((start_at, end_at))

                    # update in-memory stats so later picks remain fair
                    st = stats_by_soldier.setdefault(soldier.id, SoldierStats())
                    _update_stats_after_assignment(st, m.id, start_at, end_at, day_start, day_end)


            results.append(
                PlanResultItem(mission={"id": m.id, "name": m.name}, created_count=created_here, error=None)
            )
        except Exception as ex:
            results.append(
                PlanResultItem(mission={"id": m.id, "name": m.name}, created_count=None, error=str(ex))
            )

    db.commit()
    return FillResponse(day=req.day, results=results)

