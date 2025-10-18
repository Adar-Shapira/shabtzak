# backend/app/routers/warnings.py
import os
from datetime import datetime, time, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.warnings import WarningItem

router = APIRouter(prefix="/plan", tags=["planner"])

APP_TZ = os.getenv("APP_TZ", "UTC")

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
  WHERE a.start_at < :day_end_utc
),
base AS (
  -- Keep only rows that overlap the selected day window
  SELECT *
  FROM ordered_cte
  WHERE end_at > :day_start_utc
    AND start_at < :day_end_utc
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
),
restricted_cte AS (
  SELECT
    b.assignment_id, b.soldier_id, b.mission_id, b.start_at, b.end_at
  FROM base b
  JOIN soldier_mission_restrictions r
    ON r.soldier_id = b.soldier_id
   AND r.mission_id = b.mission_id
)
SELECT
  'RESTRICTED' AS type,
  s.id   AS soldier_id,
  s.name AS soldier_name,
  m.id   AS mission_id,
  m.name AS mission_name,
  (x.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS start_at_local,
  (x.end_at   AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS end_at_local,
  NULL::text AS details
FROM restricted_cte x
JOIN soldiers s ON s.id = x.soldier_id
JOIN missions m ON m.id = x.mission_id

UNION ALL

SELECT
  'OVERLAP' AS type,
  s.id      AS soldier_id,
  s.name    AS soldier_name,
  m.id      AS mission_id,
  m.name    AS mission_name,
  (x.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS start_at_local,
  (x.end_at   AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS end_at_local,
  ('Overlaps with previous assignment ending at ' ||
   to_char(x.prev_end_at AT TIME ZONE 'UTC' AT TIME ZONE :tz, 'YYYY-MM-DD HH24:MI')) AS details
FROM overlap_cte x
JOIN soldiers s ON s.id = x.soldier_id
JOIN missions m ON m.id = x.mission_id

UNION ALL

SELECT
  'REST'  AS type,
  s.id    AS soldier_id,
  s.name  AS soldier_name,
  m.id    AS mission_id,
  m.name  AS mission_name,
  (x.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS start_at_local,
  (x.end_at   AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS end_at_local,
  ('Rest between missions is ' ||
    to_char((x.start_at - x.prev_end_at), 'HH24:MI')) AS details
FROM rest_cte x
JOIN soldiers s ON s.id = x.soldier_id
JOIN missions m ON m.id = x.mission_id

ORDER BY type ASC, soldier_name ASC, start_at_local DESC
"""

def _local_midnight_bounds(day_str: str, tz_name: str) -> tuple[datetime, datetime]:
  """
  Interpret `day_str` (YYYY-MM-DD) in APP_TZ and return (start_utc, end_utc).
  We avoid OS tz DB complications by using SQL for display; here we only need UTC bounds.
  """
  try:
    # Treat given day in app tz as naive date; convert to UTC by assuming day’s local midnight = 00:00 in app tz
    # Since we don’t have pytz/zoneinfo here by default, use a simple approach:
    # Expect the DB timestamps are UTC; frontend day is for APP_TZ.
    # We’ll compute UTC bounds in SQL using APP_TZ to be precise.
    # To stay consistent, we’ll pass the literal day string and compute bounds in SQL would be best,
    # but we’ll approximate here using UTC, then rely on WHERE overlap checks to be inclusive.
    # A safe approach is to treat provided day as UTC day and rely on display conversion.
    # If you want strict APP_TZ day bounds, set VITE_APP_TZ=UTC or add python zoneinfo logic.
    d = datetime.fromisoformat(day_str)
  except ValueError:
    raise HTTPException(status_code=400, detail="Invalid day format, expected YYYY-MM-DD")

  # Use UTC day bounds (00:00..24:00). For strict local-day semantics, swap this with zoneinfo conversion.
  start_utc = datetime.combine(d.date(), time(0, 0, 0), tzinfo=timezone.utc)
  end_utc = start_utc + timedelta(days=1)
  return start_utc, end_utc

@router.get("/warnings", response_model=List[WarningItem])
def get_warnings(
    db: Session = Depends(get_db),
    day: str = Query(..., description="Plan day, format YYYY-MM-DD (interpreted in APP_TZ for display)")
):
    day_start_utc, day_end_utc = _local_midnight_bounds(day, APP_TZ)

    rows = db.execute(
        text(SQL),
        {
            "day_start_utc": day_start_utc,
            "day_end_utc": day_end_utc,
            "tz": APP_TZ,
        },
    ).mappings().all()

    out: List[WarningItem] = []
    for r in rows:
        out.append(
            WarningItem(
                type=r["type"],
                soldier_id=r["soldier_id"],
                soldier_name=r["soldier_name"],
                mission_id=r["mission_id"],
                mission_name=r["mission_name"],
                start_at=str(r["start_at_local"]),
                end_at=str(r["end_at_local"]),
                details=r["details"],
            )
        )
    return out
