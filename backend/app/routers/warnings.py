# backend/app/routers/warnings.py
import os
from datetime import datetime, date, time, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.warnings import WarningItem


router = APIRouter(prefix="/plan", tags=["planner"])

# Treat "about 8 hours" as 8h ± this many minutes
NEAR_EIGHT_MINUTES = 10

SQL = """
WITH ordered_cte AS (
  -- Build prev_end_at using ALL assignments up to end-of-day
  SELECT
    a.id            AS assignment_id,
    a.soldier_id,
    a.mission_id,
    a.start_at,
    a.end_at,
    LAG(a.end_at) OVER (PARTITION BY a.soldier_id ORDER BY a.start_at, a.end_at) AS prev_end_at
  FROM assignments a
  WHERE a.start_at < :day_end
),
rests AS (
  -- Compute two consecutive rest gaps per assignment:
  -- rest_seconds: gap before this assignment
  -- prev_rest_seconds: the gap before that
  SELECT
    oc.assignment_id,
    oc.soldier_id,
    oc.mission_id,
    oc.start_at,
    oc.end_at,
    oc.prev_end_at,
    EXTRACT(EPOCH FROM (oc.start_at - oc.prev_end_at)) AS rest_seconds,
    LAG(EXTRACT(EPOCH FROM (oc.start_at - oc.prev_end_at)))
      OVER (PARTITION BY oc.soldier_id ORDER BY oc.start_at, oc.end_at) AS prev_rest_seconds
  FROM ordered_cte oc
),
base AS (
  -- Keep only rows that overlap the selected day window
  SELECT *
  FROM ordered_cte
  WHERE end_at > :day_start
    AND start_at < :day_end
),
overlap_cte AS (
  SELECT
    o.assignment_id, o.soldier_id, o.mission_id, o.start_at, o.end_at, o.prev_end_at
  FROM base o
  WHERE o.prev_end_at IS NOT NULL
    AND o.start_at < o.prev_end_at
),
rest_cte AS (
  SELECT
    o.assignment_id, o.soldier_id, o.mission_id, o.start_at, o.end_at, o.prev_end_at,
    EXTRACT(EPOCH FROM (o.start_at - o.prev_end_at))/3600.0 AS rest_hours
  FROM base o
  WHERE o.prev_end_at IS NOT NULL
    AND (o.start_at - o.prev_end_at) >= interval '0 hours'
    AND (o.start_at - o.prev_end_at) < interval '8 hours'
    -- only warn for assignments that START on the selected day in APP_TZ
    AND ((o.start_at)::date = :day_date)
),
double_eight_cte AS (
  -- New RED REST: two consecutive ~8h rests.
  -- Current rest in [8h, 8h + tolerance], previous rest in [8h - tol, 8h + tol].
  SELECT
    r.assignment_id,
    r.soldier_id,
    r.mission_id,
    r.start_at,
    r.end_at,
    r.prev_end_at,
    r.rest_seconds,
    r.prev_rest_seconds
  FROM rests r
  WHERE r.prev_end_at IS NOT NULL
    -- Current rest >= 8h and <= 8h + tolerance (avoid duplicates with the strict <8h red from rest_cte)
    AND (r.start_at - r.prev_end_at) >= interval '8 hours'
    AND (r.start_at - r.prev_end_at) <= (interval '8 hours' + make_interval(mins => :near_eight_minutes))
    -- Previous rest within ±tolerance around 8h, compare on seconds
    AND r.prev_rest_seconds IS NOT NULL
    AND r.prev_rest_seconds BETWEEN (8*3600 - (:near_eight_minutes*60)) AND (8*3600 + (:near_eight_minutes*60))
    -- only warn for assignments that START on the selected day in APP_TZ
    AND ((r.start_at)::date = :day_date)
),
single_eight_cte AS (
  -- REST (orange): a single ~8h rest (current ~8h but previous rest is NOT ~8h)
  SELECT
    r.assignment_id,
    r.soldier_id,
    r.mission_id,
    r.start_at,
    r.end_at,
    r.prev_end_at,
    r.rest_seconds,
    r.prev_rest_seconds
  FROM rests r
  WHERE r.prev_end_at IS NOT NULL
    -- Current ~8h window
    AND (r.start_at - r.prev_end_at) >= interval '8 hours'
    AND (r.start_at - r.prev_end_at) <= (interval '8 hours' + make_interval(mins => :near_eight_minutes))
    -- Previous NOT ~8h (either NULL or outside ±tolerance)
    AND (
      r.prev_rest_seconds IS NULL
      OR r.prev_rest_seconds < (8*3600 - (:near_eight_minutes*60))
      OR r.prev_rest_seconds > (8*3600 + (:near_eight_minutes*60))
    )
    -- only warn for assignments that START on the selected day in APP_TZ
    AND ((r.start_at)::date = :day_date)
),
restricted_cte AS (
  SELECT
    b.assignment_id, b.soldier_id, b.mission_id, b.start_at, b.end_at
  FROM base b
  JOIN soldier_mission_restrictions r
    ON r.soldier_id = b.soldier_id
   AND r.mission_id = b.mission_id
)
-- RESTRICTED (keep same; red)
SELECT
  'RESTRICTED' AS type,
  s.id   AS soldier_id,
  s.name AS soldier_name,
  m.id   AS mission_id,
  m.name AS mission_name,
  (x.start_at) AS start_at_local,
  (x.end_at) AS end_at_local,
  NULL::text AS details,
  x.assignment_id AS assignment_id,
  'ORANGE' AS level
FROM restricted_cte x
JOIN soldiers s ON s.id = x.soldier_id
JOIN missions m ON m.id = x.mission_id

UNION ALL

-- OVERLAP (red): true temporal overlap
SELECT
  'OVERLAP' AS type,
  s.id      AS soldier_id,
  s.name    AS soldier_name,
  m.id      AS mission_id,
  m.name    AS mission_name,
  (x.start_at) AS start_at_local,
  (x.end_at) AS end_at_local,
  ('Overlaps with previous assignment ending at ' ||
   to_char(x.prev_end_at, 'YYYY-MM-DD HH24:MI')) AS details,
  x.assignment_id AS assignment_id,
  'RED' AS level
FROM overlap_cte x
JOIN soldiers s ON s.id = x.soldier_id
JOIN missions m ON m.id = x.mission_id

UNION ALL

-- OVERLAP (orange): short rest < 8h reclassified under OVERLAP
SELECT
  'OVERLAP' AS type,
  s.id    AS soldier_id,
  s.name  AS soldier_name,
  m.id    AS mission_id,
  m.name  AS mission_name,
  (x.start_at) AS start_at_local,
  (x.end_at) AS end_at_local,
  ('Rest between missions is ' ||
    to_char((x.start_at - x.prev_end_at), 'HH24:MI')) AS details,
  x.assignment_id AS assignment_id,
  'ORANGE' AS level
FROM rest_cte x
JOIN soldiers s ON s.id = x.soldier_id
JOIN missions m ON m.id = x.mission_id

UNION ALL

-- REST (red): two consecutive ~8h rests
SELECT
  'REST'  AS type,
  s.id    AS soldier_id,
  s.name  AS soldier_name,
  m.id    AS mission_id,
  m.name  AS mission_name,
  (d.start_at) AS start_at_local,
  (d.end_at) AS end_at_local,
  ('Two consecutive ~8h rests: ' ||
    to_char((d.start_at - d.prev_end_at), 'HH24:MI') || ' and ' ||
    to_char(((d.prev_rest_seconds::int || ' seconds')::interval), 'HH24:MI')
  ) AS details,
  d.assignment_id AS assignment_id,
  'RED' AS level
FROM double_eight_cte d
JOIN soldiers s ON s.id = d.soldier_id
JOIN missions m ON m.id = d.mission_id

UNION ALL

-- REST (orange): a single ~8h rest
SELECT
  'REST'  AS type,
  s.id    AS soldier_id,
  s.name  AS soldier_name,
  m.id    AS mission_id,
  m.name  AS mission_name,
  (d.start_at) AS start_at_local,
  (d.end_at) AS end_at_local,
  ('Rest between missions is ' ||
    to_char((d.start_at - d.prev_end_at), 'HH24:MI')) AS details,
  d.assignment_id AS assignment_id,
  'ORANGE' AS level
FROM single_eight_cte d
JOIN soldiers s ON s.id = d.soldier_id
JOIN missions m ON m.id = d.mission_id

ORDER BY type ASC, soldier_name ASC, start_at_local DESC
"""

def _local_midnight_bounds(day_str: str) -> tuple[datetime, datetime]:
  try:
    d = date.fromisoformat(day_str)
  except ValueError:
    raise HTTPException(status_code=400, detail="Invalid day format, expected YYYY-MM-DD")
  start_local = datetime(d.year, d.month, d.day, 0, 0, 0)
  end_local = start_local + timedelta(days=1)
  return start_local, end_local

@router.get("/warnings", response_model=List[WarningItem])
def get_warnings(
    db: Session = Depends(get_db),
    day: str = Query(..., description="Plan day, format YYYY-MM-DD (interpreted in APP_TZ for display)")
):
    day_start, day_end = _local_midnight_bounds(day)
    day_date = date.fromisoformat(day)

    rows = db.execute(
        text(SQL),
        {
            "day_start": day_start,
            "day_end": day_end,
            "day_date": day_date,
            "near_eight_minutes": NEAR_EIGHT_MINUTES,
        },
    ).mappings().all()

    out: List[WarningItem] = []
    for r in rows:
        # Convert datetime to isoformat string (no timezone)
        start_at_val = r["start_at_local"]
        end_at_val = r["end_at_local"]
        
        start_at_str = start_at_val.isoformat(timespec="seconds") if isinstance(start_at_val, datetime) else str(start_at_val)
        end_at_str = end_at_val.isoformat(timespec="seconds") if isinstance(end_at_val, datetime) else str(end_at_val)
        
        out.append(
            WarningItem(
                type=r["type"],
                soldier_id=r["soldier_id"],
                soldier_name=r["soldier_name"],
                mission_id=r["mission_id"],
                mission_name=r["mission_name"],
                start_at=start_at_str,
                end_at=end_at_str,
                details=r["details"],
                assignment_id=r.get("assignment_id"),
                level=r.get("level"),
            )
        )

    return out
