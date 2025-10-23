# backend/app/routers/warnings.py
import os
from datetime import datetime, date, time, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.warnings import WarningItem

from zoneinfo import ZoneInfo

router = APIRouter(prefix="/plan", tags=["planner"])

APP_TZ = os.getenv("APP_TZ", "UTC")
_TZ = ZoneInfo(APP_TZ)

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
    -- only warn for assignments that START on the selected day in APP_TZ
    AND ((o.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date = :day_date)
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
    AND ((o.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date = :day_date)
),
restricted_cte AS (
  SELECT
    b.assignment_id, b.soldier_id, b.mission_id, b.start_at, b.end_at
  FROM base b
  JOIN soldier_mission_restrictions r
    ON r.soldier_id = b.soldier_id
   AND r.mission_id = b.mission_id
  -- only warn for assignments that START on the selected day in APP_TZ
  WHERE ((b.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date = :day_date)
)
SELECT
  'RESTRICTED' AS type,
  s.id   AS soldier_id,
  s.name AS soldier_name,
  m.id   AS mission_id,
  m.name AS mission_name,
  (x.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS start_at_local,
  (x.end_at   AT TIME ZONE 'UTC' AT TIME ZONE :tz) AS end_at_local,
  NULL::text AS details,
  x.assignment_id AS assignment_id
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
   to_char(x.prev_end_at AT TIME ZONE 'UTC' AT TIME ZONE :tz, 'YYYY-MM-DD HH24:MI')) AS details,
  x.assignment_id AS assignment_id
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
    to_char((x.start_at - x.prev_end_at), 'HH24:MI')) AS details,
  x.assignment_id AS assignment_id
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
    d = date.fromisoformat(day_str)
  except ValueError:
    raise HTTPException(status_code=400, detail="Invalid day format, expected YYYY-MM-DD")
  start_local = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=_TZ)
  end_local = start_local + timedelta(days=1)
  return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)

@router.get("/warnings", response_model=List[WarningItem])
def get_warnings(
    db: Session = Depends(get_db),
    day: str = Query(..., description="Plan day, format YYYY-MM-DD (interpreted in APP_TZ for display)")
):
    day_start_utc, day_end_utc = _local_midnight_bounds(day, APP_TZ)
    day_date = date.fromisoformat(day)

    rows = db.execute(
        text(SQL),
        {
            "day_start_utc": day_start_utc,
            "day_end_utc": day_end_utc,
            "tz": APP_TZ,
            "day_date": day_date,
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
                assignment_id=r.get("assignment_id"),
            )
        )
    return out
