# backend/app/routers/planning.py
from __future__ import annotations

from datetime import datetime, date, timedelta
from typing import Dict, List, Optional
import math

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

import random

router = APIRouter(prefix="/plan", tags=["planning"])

class FillRequest(BaseModel):
    day: str = Field(..., description="YYYY-MM-DD")
    mission_ids: Optional[List[int]] = None
    replace: bool = False  # if true, clear existing assignments for these missions/day before filling
    shuffle: bool = False  # NEW: randomize pools / RR cursors to generate a different (still valid) plan
    random_seed: Optional[int] = None  # NEW: deterministic shuffle if provided
    exclude_slots: Optional[List[str]] = None  # NEW: slot keys to exclude from assignment
    locked_assignments: Optional[List[int]] = None  # NEW: assignment IDs to preserve during fill/shuffle

class PlanResultItem(BaseModel):
    mission: dict
    created_count: int | None = None
    error: str | None = None

class FillResponse(BaseModel):
    day: str
    results: List[PlanResultItem]

class UnassignRequest(BaseModel):
    assignment_id: int

def _naive(dt: datetime) -> datetime:
    return dt if dt.tzinfo is None else dt.replace(tzinfo=None)

def _parse_day(day_str: str) -> date:
    try:
        return date.fromisoformat(day_str)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid day format; expected YYYY-MM-DD")

def _day_bounds(d: date) -> tuple[datetime, datetime]:
    start_local = datetime(d.year, d.month, d.day)
    end_local = start_local + timedelta(days=1)
    return start_local, end_local

def _slot_bucket(dt: datetime) -> str:
    """Return a coarse time-slot bucket based on naive hour."""
    h = dt.hour
    if 6 <= h < 14:
        return "MORNING"
    if 14 <= h < 22:
        return "EVENING"
    return "NIGHT"

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

    day_start_local = datetime(the_day.year, the_day.month, the_day.day, 0, 0, 0)
    day_end_local = day_start_local + timedelta(days=1)

    for v in vacs:
        s_id = v.soldier_id
        # Determine which pattern applies
        if v.start_date < the_day < v.end_date:
            block_start_local = day_start_local
            block_end_local = day_end_local
            blocks.setdefault(s_id, []).append((block_start_local, block_end_local))
        elif v.start_date == the_day == v.end_date:
            # Single-day vacation → block only from 14:00 local to end-of-day
            block_start_local = day_start_local.replace(hour=14, minute=0, second=0, microsecond=0)
            block_end_local = day_end_local
            blocks.setdefault(s_id, []).append((block_start_local, block_end_local))
        elif v.start_date == the_day and v.end_date > the_day:
            block_start_local = day_start_local.replace(hour=14, minute=0, second=0, microsecond=0)
            block_end_local = day_end_local
            blocks.setdefault(s_id, []).append((block_start_local, block_end_local))
        elif v.end_date == the_day and v.start_date < the_day:
            block_start_local = day_start_local
            block_end_local = day_start_local.replace(hour=14, minute=0, second=0, microsecond=0)
            blocks.setdefault(s_id, []).append((block_start_local, block_end_local))
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

def _nearest_gaps_hours(
    occupied: List[tuple[datetime, datetime]],
    cand_start: datetime,
    cand_end: datetime,
) -> tuple[float, float]:
    """
    Returns (gap_before_hours, gap_after_hours) with respect to the nearest
    existing assignments in `occupied`. If none on one side, treat as a large gap.
    """
    if not occupied:
        # No neighbors -> huge effective rest both sides
        return 1e6, 1e6

    prev_end = None
    next_start = None
    for s, e in occupied:
        if e <= cand_start and (prev_end is None or e > prev_end):
            prev_end = e
        if s >= cand_end and (next_start is None or s < next_start):
            next_start = s

    gap_before = (cand_start - prev_end).total_seconds() / 3600.0 if prev_end else 1e6
    gap_after = (next_start - cand_end).total_seconds() / 3600.0 if next_start else 1e6
    return gap_before, gap_after

# -------- Fairness/Rotation configuration --------
FAIRNESS_WINDOW_DAYS = 14  # look back this many days for rotation/workload stats
EIGHT_HOURS = timedelta(hours=8)

# We minimize this score (lower = more preferred).
# Tweak weights to taste; all are >= 0.
WEIGHTS = {
    "recent_gap_penalty_per_hour_missing": 2.0,     # strong penalty if < 8h
    "same_mission_recent_penalty": 5.0,
    "mission_repeat_count_penalty": 1.0,
    "today_assignment_count_penalty": 3.0,
    "total_hours_window_penalty_per_hour": 0.08,

    # Make extra rest (beyond 8h) much more attractive, so under-rested soldiers keep resting now.
    "recent_gap_boost_per_hour": -1.2,              # was -0.4

    "slot_repeat_count_penalty": 0.75,
    "coassignment_repeat_penalty": 0.5,

    # New: explicitly push the algorithm toward max-min rest across the day.
    # Reward large 'gap before' (assign the most rested now) and avoid shrinking the 'gap after'.
    "rest_before_priority_per_hour": -1.0,          # favors candidates with larger rest before
    "rest_after_priority_per_hour": -0.5,           # disfavors creating a short next rest
}

class SoldierStats:
    __slots__ = (
        "last_end_at",             # datetime | None
        "today_count",             # int
        "total_hours_window",      # float hours
        "mission_count",           # Dict[int, int]
        "recent_missions",         # set[int]
        "slot_bucket_count",       # Dict[str, int]  # NEW
    )
    def __init__(self):
        self.last_end_at = None
        self.today_count = 0
        self.total_hours_window = 0.0
        self.mission_count = {}
        self.recent_missions = set()
        self.slot_bucket_count = {}  # NEW

def _fetch_recent_assignments(db: Session, day_start: datetime, day_end: datetime) -> List[Assignment]:
    window_start = day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)
    # Bring assignments from [window_start, day_end) to compute stats
    return db.execute(
        select(Assignment)
        .where(Assignment.end_at > window_start)
        .where(Assignment.start_at < day_end)
    ).scalars().all()

def _build_pair_counts(recent: List[Assignment]) -> Dict[int, Dict[int, int]]:
    """
    For each soldier, count how many times they were co-assigned with each fellow soldier
    in the same mission window within the fairness window.
    Returns: {soldier_id: {fellow_id: count}}
    """
    from collections import defaultdict
    # key by exact window (mission_id, start_at, end_at) → collect soldier ids
    by_key = defaultdict(list)
    for a in recent:
        by_key[(a.mission_id, a.start_at, a.end_at)].append(a.soldier_id)

    pair_counts: Dict[int, Dict[int, int]] = {}
    for soldiers in by_key.values():
        if len(soldiers) < 2:
            continue
        for i in range(len(soldiers)):
            for j in range(i + 1, len(soldiers)):
                s1, s2 = soldiers[i], soldiers[j]
                pair_counts.setdefault(s1, {}).setdefault(s2, 0)
                pair_counts.setdefault(s2, {}).setdefault(s1, 0)
                pair_counts[s1][s2] += 1
                pair_counts[s2][s1] += 1
    return pair_counts

def _build_soldier_stats(recent: List[Assignment], day_start: datetime, day_end: datetime) -> Dict[int, SoldierStats]:
    stats: Dict[int, SoldierStats] = {}
    for a in recent:
        sa = _naive(a.start_at)
        ea = _naive(a.end_at)
        s_id = a.soldier_id
        st = stats.setdefault(s_id, SoldierStats())

        # last_end_at: keep the latest assignment end strictly before day_start
        if ea <= day_start:
            if st.last_end_at is None or ea > st.last_end_at:
                st.last_end_at = ea

        # today_count: overlaps the selected day
        if not (ea <= day_start or sa >= day_end):
            st.today_count += 1

        # total hours in lookback window
        window_start = day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)
        seg_start = max(sa, window_start)
        seg_end = min(ea, day_end)
        if seg_end > seg_start:
            st.total_hours_window += (seg_end - seg_start).total_seconds() / 3600.0

        # mission rotation stats
        if sa < day_end and ea > (day_start - timedelta(days=FAIRNESS_WINDOW_DAYS)):
            st.mission_count[a.mission_id] = st.mission_count.get(a.mission_id, 0) + 1
            st.recent_missions.add(a.mission_id)

        bucket = _slot_bucket(sa)
        st.slot_bucket_count[bucket] = st.slot_bucket_count.get(bucket, 0) + 1

    return stats

def _overlap_seconds(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    x_start = max(a_start, b_start)
    x_end = min(a_end, b_end)
    if x_end > x_start:
        return (x_end - x_start).total_seconds()
    return 0.0

def _score_candidate(
    soldier: Soldier,
    mission_id: int,
    start_at: datetime,
    end_at: datetime,
    st: SoldierStats,
    assigned_here: set[int],                                  # NEW
    pair_counts: Dict[int, Dict[int, int]],                   # NEW
    vacation_blocks: Dict[int, List[tuple[datetime, datetime]]],  # NEW
) -> float:
    score = 0.0

    # 1) Rest maximization: prefer larger gap; penalize gaps under 8h
    # If no last_end_at, treat as well-rested (small boost from duration itself).
    if st.last_end_at is not None:
        gap = start_at - st.last_end_at
        # subtract vacation time from the gap (vacation is NOT rest)
        vac_secs = 0.0
        for (bs_utc, be_utc) in vacation_blocks.get(soldier.id, []):
            vac_secs += _overlap_seconds(st.last_end_at, start_at, bs_utc, be_utc)
        if vac_secs > 0:
            gap = timedelta(seconds=max(0.0, gap.total_seconds() - vac_secs))

        if gap < timedelta(0):
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

    # NEW: penalize repeating the same time-slot bucket (M/E/N)
    bucket = _slot_bucket(start_at)
    if bucket:
        bucket_count = st.slot_bucket_count.get(bucket, 0)
        if bucket_count > 0:
            score += WEIGHTS.get("slot_repeat_count_penalty", 0.75) * float(bucket_count)

    # NEW: penalize repeated pairing with the same fellow soldiers in this window
    if assigned_here:
        pairs = pair_counts.get(soldier.id, {})
        for fellow_id in assigned_here:
            c = pairs.get(fellow_id, 0)
            if c > 0:
                score += WEIGHTS.get("coassignment_repeat_penalty", 0.5) * float(c)

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
            selectinload(Mission.requirements).selectinload(MissionRequirement.role),
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

def _collect_candidates_for_slot(
    pool,
    m_id: int,
    start_at: datetime,
    end_at: datetime,
    stats_by_soldier: Dict[int, SoldierStats],
    restricted_pairs: set[tuple[int, int]],
    existing_same_window: set[tuple[int, datetime, datetime]],
    occupied_by_soldier: Dict[int, List[tuple[datetime, datetime]]],
    vacation_blocks: Dict[int, List[tuple[datetime, datetime]]],
    rr_start_idx: int,
    strict: bool,
    assigned_here: set[int],                                  
    pair_counts: Dict[int, Dict[int, int]],
    shuffle_mode: bool = False,
    rng: Optional[random.Random] = None,                   
) -> List[tuple[float, int, Soldier]]:
    """Return scored candidates. If strict=False, relax the 8h rest checks."""
    scored: List[tuple[float, int, Soldier]] = []
    start_at = _naive(start_at)
    end_at   = _naive(end_at)
    for i, cand in enumerate(pool):
        # never violate hard constraints
        if (cand.id, m_id) in restricted_pairs:
            continue
        if (cand.id, start_at, end_at) in existing_same_window:
            continue
        if any(_overlaps(start_at, end_at, s, e) for (s, e) in occupied_by_soldier.get(cand.id, [])):
            continue
        if any(bs_utc < end_at and be_utc > start_at for (bs_utc, be_utc) in vacation_blocks.get(cand.id, [])):
            continue

        st = stats_by_soldier.setdefault(cand.id, SoldierStats())

        if strict:
            occ_list = occupied_by_soldier.get(cand.id, [])
            if not _has_8h_rest_around(occ_list, start_at, end_at, EIGHT_HOURS):
                continue
        # else: soft mode → allow <8h; warnings will be produced by your warnings endpoint

        base_score = _score_candidate(
            cand, m_id, start_at, end_at, st,
            assigned_here=assigned_here,
            pair_counts=pair_counts,
            vacation_blocks=vacation_blocks,
        )

        # Fairness add-on: push toward max-min rest across the day.
        # Compute nearest rest gaps around this potential placement.
        occ_list = occupied_by_soldier.get(cand.id, [])
        gap_before_h, gap_after_h = _nearest_gaps_hours(occ_list, start_at, end_at)

        # Reward assigning the most-rested soldier now (big gap_before),
        # and avoid creating too-short future rests (penalize small gap_after).
        rest_adjust = (
            WEIGHTS.get("rest_before_priority_per_hour", 0.0) * gap_before_h
            + WEIGHTS.get("rest_after_priority_per_hour", 0.0) * gap_after_h
        )

        rr_distance = (i - rr_start_idx) % max(1, len(pool))
        score = base_score + rest_adjust + rr_distance * 0.001

        scored.append((score, i, cand))


    scored.sort(key=lambda t: (t[0], t[1]))
    return scored

@router.post("/fill", response_model=FillResponse)
def fill(req: FillRequest, db: Session = Depends(get_db)):
    from datetime import timezone
    
    the_day = _parse_day(req.day)
    day_start, day_end = _day_bounds(the_day)
    
    # Convert day bounds to UTC-aware datetimes for database comparisons
    # The database stores timezone-aware datetimes, so we need to match that for WHERE clauses
    day_start_aware = day_start.replace(tzinfo=timezone.utc)
    day_end_aware = day_end.replace(tzinfo=timezone.utc)
    
    ctx = _load_context(db)
    vacation_blocks = _vacation_blocks_for_day(db, the_day)
    recent_assignments = _fetch_recent_assignments(db, day_start_aware, day_end_aware)
    stats_by_soldier = _build_soldier_stats(recent_assignments, day_start, day_end)
    pair_counts = _build_pair_counts(recent_assignments)
    
    if req.exclude_slots:
        print(f"[DEBUG] Total excluded slots: {len(req.exclude_slots)}")
        print(f"[DEBUG] Excluded slots: {req.exclude_slots}")
    if req.locked_assignments:
        print(f"[DEBUG] Locked assignment IDs: {req.locked_assignments}")

    # Optional shuffle: produce a different yet valid plan
    if req.random_seed is not None:
        rng = random.Random(req.random_seed)
    else:
        # Use system time and OS random bytes for a unique seed each time
        import time
        import os
        seed = int.from_bytes(os.urandom(8), 'big') ^ time.time_ns()
        rng = random.Random(seed)
    
    if req.shuffle:
        # Shuffle per-role pools and generic pool in-place (copy-safe as they are lists we own)
        for role_id, lst in ctx["soldiers_by_role"].items():
            rng.shuffle(lst)
        rng.shuffle(ctx["all_soldiers"])

    # Exact-window duplicates that already exist today
    existing_same_window = set(
        (sid, _naive(s_at), _naive(e_at))
        for sid, s_at, e_at in db.execute(
            select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
            .where(Assignment.start_at < day_end_aware)
            .where(Assignment.end_at > day_start_aware)
        ).all()
    )

    # Per-soldier occupied intervals that touch the day (for general overlap checks)
    occupied_by_soldier: Dict[int, List[tuple[datetime, datetime]]] = {}
    for sid, s_at, e_at in db.execute(
        select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
        .where(Assignment.start_at < day_end_aware)
        .where(Assignment.end_at > day_start_aware)
    ).all():
        s_na, e_na = _naive(s_at), _naive(e_at)
        occupied_by_soldier.setdefault(sid, []).append((s_na, e_na))

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

    if req.shuffle:
        # Pre-seed per-role cursors and the generic cursor with random offsets
        for role_id in ctx["soldiers_by_role"].keys():
            rr_index[role_id] = rng.randrange(0, 1000)
        rr_index[None] = rng.randrange(0, 1000)

    # One-shot clear (so in-memory lookups reflect the actual DB state)
    if req.replace:
        ids_to_clear = [mm.id for mm in mission_list]
        if ids_to_clear:
            # Build delete statement
            delete_conditions = [
                Assignment.mission_id.in_(ids_to_clear),
                Assignment.start_at >= day_start_aware,
                Assignment.start_at < day_end_aware,
            ]
            
            # Exclude locked assignments from deletion
            if req.locked_assignments:
                delete_conditions.append(~Assignment.id.in_(req.locked_assignments))
            
            # Use timezone-aware datetimes for WHERE clause comparison with database
            stmt = delete(Assignment).where(and_(*delete_conditions))
            db.execute(stmt)

            # Rebuild lookups from DB after delete
            existing_same_window = set(
                (sid, _naive(s_at), _naive(e_at))
                for sid, s_at, e_at in db.execute(
                    select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
                    .where(Assignment.start_at < day_end_aware)
                    .where(Assignment.end_at > day_start_aware)
                ).all()
            )

            occupied_by_soldier: Dict[int, List[tuple[datetime, datetime]]] = {}
            for sid, s_at, e_at in db.execute(
                select(Assignment.soldier_id, Assignment.start_at, Assignment.end_at)
                .where(Assignment.start_at < day_end_aware)
                .where(Assignment.end_at > day_start_aware)
            ).all():
                s_na, e_na = _naive(s_at), _naive(e_at)
                occupied_by_soldier.setdefault(sid, []).append((s_na, e_na))

    # ----------------------------
    # Phase 1: assign REQUIRED roles across all missions and slots
    # ----------------------------
    for m in mission_list:
        try:
            slots: List[MissionSlot] = sorted(m.slots, key=lambda s: (s.start_time, s.end_time))
            reqs: List[MissionRequirement] = m.requirements or []

            # Skip only if there are no slots
            if not slots:
                results.append(
                    PlanResultItem(mission={"id": m.id, "name": m.name}, created_count=0, error=None)
                )
                continue

            # explicit role demands only (no generic here)
            # Sort by role name to match API ordering (for consistent exclusion keys)
            explicit_roles: List[int] = []
            for r in sorted(reqs, key=lambda x: (x.role.name if x.role else "", x.role_id if hasattr(x, 'role_id') else 0)):
                if r.count and r.count > 0:
                    explicit_roles.extend([r.role_id] * r.count)

            created_here = 0

            for slot in slots:
                start_at, end_at = Assignment.window_for(slot.start_time, slot.end_time, the_day)

                # track who we've already placed in THIS slot/window
                assigned_here: set[int] = set()

                # Track the ABSOLUTE position within THIS slot's assignments (across all roles)
                absolute_slot_position = 0
                
                for role_id in explicit_roles:
                    # Check if this specific instance should be excluded
                    # Format: mission_id_roleId_start_at_end_at_index (UI sends absolute position)
                    # UI appends :00 to isoformat() result: 2025-10-28T22:00:00 → 2025-10-28T22:00:00:00
                    start_str = f"{start_at.isoformat()}:00"
                    end_str = f"{end_at.isoformat()}:00"
                    slot_key_base = f"{m.id}_{role_id}_{start_str}_{end_str}"
                    slot_key_to_check = f"{slot_key_base}_{absolute_slot_position}"
                    
                    if req.exclude_slots and slot_key_to_check in req.exclude_slots:
                        # This specific instance is excluded - skip it
                        absolute_slot_position += 1  # Increment even when skipped to keep position tracking
                        continue
                    
                    # decide the pool
                    pool = [
                        s for s in ctx["soldiers_by_role"].get(role_id, [])
                        if (s.id, m.id) not in restricted_pairs
                    ]

                    # Remove anyone who is already assigned to this exact window
                    pool = [s for s in pool if (s.id, start_at, end_at) not in existing_same_window]

                    # Filter out overlap with vacations or existing assignments
                    # Overlaps handled by occupied_by_soldier; vacations blocked by _collect logic
                    if not pool:
                        absolute_slot_position += 1  # Increment even when no pool
                        continue

                    # round-robin starting point for this role
                    start_idx = rr_index.get(role_id, 0)

                    # Strict pass ONLY (no red warnings allowed)
                    scored = _collect_candidates_for_slot(
                        pool=pool,
                        m_id=m.id,
                        start_at=start_at,
                        end_at=end_at,
                        stats_by_soldier=stats_by_soldier,
                        restricted_pairs=restricted_pairs,
                        existing_same_window=existing_same_window,
                        occupied_by_soldier=occupied_by_soldier,
                        vacation_blocks=vacation_blocks,
                        rr_start_idx=start_idx,
                        strict=True,
                        assigned_here=assigned_here,            # NEW
                        pair_counts=pair_counts,                # NEW
                        shuffle_mode=req.shuffle,                # NEW
                        rng=rng if req.shuffle else None,        # NEW
                    )

                    # If we have nobody, leave the seat empty
                    if not scored:
                        absolute_slot_position += 1  # Increment even when no candidates found
                        continue

                    # In shuffle mode, pick randomly from top candidates for variety
                    if req.shuffle and len(scored) > 0:
                        # Pick from top candidates (top 30% or at least 10), favoring better scores
                        top_n = min(max(10, len(scored) // 3), len(scored))
                        # Random index weighted toward beginning (better scores)
                        rand_val = rng.random() * rng.random()  # Square distribution favors lower values
                        idx = int(rand_val * top_n)
                        chosen_score, chosen_i, soldier = scored[idx]
                    else:
                        chosen_score, chosen_i, soldier = scored[0]

                    # advance RR cursor to next after chosen_i for this role
                    rr_index[role_id] = (chosen_i + 1) % max(1, len(pool))

                    # remember this soldier is used for this slot, so we won't pick them again
                    assigned_here.add(soldier.id)

                    a = Assignment(
                        mission_id=m.id,
                        soldier_id=soldier.id,
                        role_id=role_id,
                        start_at=start_at,
                        end_at=end_at,
                    )
                    db.add(a)
                    created_here += 1
                    
                    # Increment the slot position counter
                    absolute_slot_position += 1

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
                PlanResultItem(
                    mission={"id": m.id, "name": m.name}, created_count=None, error=str(ex)
                )
            )

    # ----------------------------
    # Phase 2: assign GENERIC seats across all missions and slots
    # ----------------------------
    for m in mission_list:
        try:
            slots: List[MissionSlot] = sorted(m.slots, key=lambda s: (s.start_time, s.end_time))
            reqs: List[MissionRequirement] = m.requirements or []

            if not slots:
                # already appended result in phase 1
                continue

            # calculate how many generics are required
            sum_explicit = sum((r.count or 0) for r in reqs)
            generic_count = 0
            if getattr(m, "total_needed", None):
                remaining = max(0, int(m.total_needed or 0) - sum_explicit)
                if remaining > 0:
                    generic_count = remaining

            created_here = 0

            for slot in slots:
                start_at, end_at = Assignment.window_for(slot.start_time, slot.end_time, the_day)

                assigned_here: set[int] = set()

                # generic seats for this mission window
                # Track the position for generic slots (starts after explicit roles)
                # Calculate explicit roles count for this mission (sorted by role name for consistency with UI)
                explicit_roles_list: List[int] = []
                for r in sorted(reqs, key=lambda x: (x.role.name if x.role else "", x.role_id if hasattr(x, 'role_id') else 0)):
                    if r.count and r.count > 0:
                        explicit_roles_list.extend([r.role_id] * r.count)
                
                # Get existing generic assignments for this time slot
                existing_generic = db.execute(
                    select(Assignment)
                    .where(Assignment.mission_id == m.id)
                    .where(Assignment.role_id == None)
                    .where(Assignment.start_at == start_at)
                    .where(Assignment.end_at == end_at)
                    .where(Assignment.start_at >= day_start_aware)
                    .where(Assignment.start_at < day_end_aware)
                ).scalars().all()
                
                # Get the IDs of locked generic assignments
                locked_generic_ids = set()
                if req.locked_assignments:
                    locked_generic_ids = set(req.locked_assignments)
                
                # Count how many existing generic slots are locked (won't be deleted)
                locked_generic_count = sum(1 for a in existing_generic if a.id in locked_generic_ids)
                
                # IMPORTANT: The UI generates exclusion keys with positions that include locked slots
                # So we need to check each position in sequence and skip locked ones
                # Start checking from the first generic position
                current_generic_position = len(explicit_roles_list)
                
                # Track how many slots we've created in this iteration
                slots_created_this_iteration = 0
                
                # Count how many exclusion keys exist for this time slot and mission
                exclusion_keys_for_this_slot = []
                if req.exclude_slots:
                    slot_key_prefix = f"{m.id}_GENERIC_{start_at.isoformat()}:00_{end_at.isoformat()}:00"
                    exclusion_keys_for_this_slot = [k for k in req.exclude_slots if k.startswith(slot_key_prefix)]
                
                # Count how many positions in the first generic_count positions are excluded
                excluded_in_valid_range = 0
                for pos in range(generic_count):
                    position_to_check = len(explicit_roles_list) + pos
                    start_str = f"{start_at.isoformat()}:00"
                    end_str = f"{end_at.isoformat()}:00"
                    key_for_pos = f"{m.id}_GENERIC_{start_str}_{end_str}_{position_to_check}"
                    if req.exclude_slots and key_for_pos in req.exclude_slots:
                        excluded_in_valid_range += 1
                
                print(f"[DEBUG Phase2] Mission {m.id}: generic_count={generic_count}, existing_locked={len(existing_generic)}, excluded_in_range={excluded_in_valid_range}")
                
                # We need: (generic_count) total slots
                # We have: (existing_locked) locked slots + (slots_created) newly created
                # We exclude: (excluded_in_valid_range) positions that should remain empty
                # So: existing_locked + slots_created + excluded_in_valid_range should be <= generic_count
                # This means we should only create until: existing_locked + created + excluded >= generic_count
                # Or: slots_created >= generic_count - existing_locked - excluded_in_valid_range
                
                # Check positions sequentially until we've filled the requirement
                # Formula: generic_count = existing_locked + newly_created + (excluded positions that will remain empty)
                # So: we need to create: generic_count - existing_locked new assignments
                # BUT if positions in the first generic_count are excluded, we don't need to fill them
                # So the minimum to create is: generic_count - existing_locked - excluded_in_valid_range
                min_to_create = generic_count - len(existing_generic) - excluded_in_valid_range
                print(f"[DEBUG Phase2] Need to create at least {min_to_create} new assignments (total={generic_count}, locked={len(existing_generic)}, excluded={excluded_in_valid_range})")
                
                for i in range(generic_count * 2):  # Check more positions in case some are skipped
                    # Stop when we've created enough
                    if slots_created_this_iteration >= min_to_create:
                        print(f"[DEBUG Phase2] Done: created={slots_created_this_iteration} >= min={min_to_create}")
                        break
                    
                    # Don't go beyond the logical first generic_count positions within THIS time slot
                    # Each time slot should only have generic_count generic slots
                    # Calculate position within the generic range (0-based)
                    position_in_generic_range = current_generic_position - len(explicit_roles_list)
                    if position_in_generic_range >= generic_count:
                        print(f"[DEBUG Phase2] Position {current_generic_position} (slot #{position_in_generic_range}) is beyond generic_count ({generic_count}), stopping")
                        break
                    
                    slots_needed = generic_count - len(existing_generic) - slots_created_this_iteration
                    print(f"[DEBUG Phase2] Checking position {current_generic_position} (slot {position_in_generic_range}): slots_needed={slots_needed}, existing={len(existing_generic)}, created={slots_created_this_iteration}, excluded={excluded_in_valid_range}")
                    
                    # Check if this specific generic slot instance should be excluded
                    # Format: mission_id_GENERIC_start_at_end_at_index 
                    # The index is the absolute position across all slots (explicit + generic)
                    # Match Phase 1 format for consistency
                    start_str = f"{start_at.isoformat()}:00"
                    end_str = f"{end_at.isoformat()}:00"
                    slot_key_base = f"{m.id}_GENERIC_{start_str}_{end_str}"
                    slot_key_to_check = f"{slot_key_base}_{current_generic_position}"
                    
                    # Check if this position is excluded
                    is_excluded = req.exclude_slots and slot_key_to_check in req.exclude_slots
                    
                    if is_excluded:
                        # This position is excluded - skip it
                        print(f"[DEBUG Phase2] SKIPPING position {current_generic_position}: EXCLUDED (key: {slot_key_to_check})")
                        current_generic_position += 1
                        continue
                    
                    # anyone valid for the mission (any role), excluding restricted pairs
                    pool = [
                        s for s in ctx["all_soldiers"]
                        if (s.id, m.id) not in restricted_pairs
                    ]

                    # Remove anyone who is already assigned to this exact window
                    pool = [s for s in pool if (s.id, start_at, end_at) not in existing_same_window]
                    
                    if not pool:
                        print(f"[DEBUG Phase2] No pool at position {current_generic_position} (already has assignments)")
                        current_generic_position += 1  # Increment even when no pool
                        continue

                    # round-robin starting point for "generic" (key None)
                    start_idx = rr_index.get(None, 0)

                    # Strict pass ONLY (no red warnings allowed)
                    scored = _collect_candidates_for_slot(
                        pool=pool,
                        m_id=m.id,
                        start_at=start_at,
                        end_at=end_at,
                        stats_by_soldier=stats_by_soldier,
                        restricted_pairs=restricted_pairs,
                        existing_same_window=existing_same_window,
                        occupied_by_soldier=occupied_by_soldier,
                        vacation_blocks=vacation_blocks,
                        rr_start_idx=start_idx,
                        strict=True,
                        assigned_here=assigned_here,            # NEW
                        pair_counts=pair_counts,                # NEW
                        shuffle_mode=req.shuffle,                # NEW
                        rng=rng if req.shuffle else None,        # NEW
                    )

                    if not scored:
                        current_generic_position += 1  # Increment even when no candidates
                        continue

                    # In shuffle mode, pick randomly from top candidates for variety
                    if req.shuffle and len(scored) > 0:
                        # Pick from top candidates (top 30% or at least 10), favoring better scores
                        top_n = min(max(10, len(scored) // 3), len(scored))
                        # Random index weighted toward beginning (better scores)
                        rand_val = rng.random() * rng.random()  # Square distribution favors lower values
                        idx = int(rand_val * top_n)
                        chosen_score, chosen_i, soldier = scored[idx]
                    else:
                        chosen_score, chosen_i, soldier = scored[0]

                    # advance RR cursor for generic seats (key None)
                    rr_index[None] = (chosen_i + 1) % max(1, len(pool))

                    assigned_here.add(soldier.id)

                    a = Assignment(
                        mission_id=m.id,
                        soldier_id=soldier.id,
                        role_id=None,
                        start_at=start_at,
                        end_at=end_at,
                    )
                    db.add(a)
                    created_here += 1
                    slots_created_this_iteration += 1
                    
                    existing_same_window.add((soldier.id, start_at, end_at))
                    occupied_by_soldier.setdefault(soldier.id, []).append((start_at, end_at))
                    
                    # Increment the generic position counter
                    current_generic_position += 1

                    st = stats_by_soldier.setdefault(soldier.id, SoldierStats())
                    _update_stats_after_assignment(st, m.id, start_at, end_at, day_start, day_end)

            # Phase 2 doesn’t append a second result row; counts for mission were already added in phase 1.
            # If you prefer, you can merge counts or report separately.

        except Exception as ex:
            # If something fails in phase 2, add an error row (optional)
            results.append(
                PlanResultItem(
                    mission={"id": m.id, "name": m.name}, created_count=None, error=str(ex)
                )
            )

    db.commit()
    
    # Debug: log how many assignments were created
    total_created = sum(r.created_count or 0 for r in results)
    print(f"[DEBUG] fill: day={req.day}, replace={req.replace}, shuffle={req.shuffle}, total_assignments_created={total_created}")
    
    return FillResponse(day=req.day, results=results)

@router.post("/unassign_assignment")
def unassign_assignment(req: UnassignRequest, db: Session = Depends(get_db)):
    a = db.get(Assignment, req.assignment_id)
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Save the assignment ID and soldier info before deletion
    assignment_id = a.id
    soldier_id = a.soldier_id
    soldier_name = None
    if a.soldier:
        soldier_name = a.soldier.name

    # Delete the assignment entirely instead of setting soldier_id to null
    # This avoids unique constraint violations when multiple unassigned slots exist
    db.delete(a)
    db.commit()

    return {
        "id": assignment_id,
        "soldier_id": soldier_id,
        "soldier_name": soldier_name,
    }
