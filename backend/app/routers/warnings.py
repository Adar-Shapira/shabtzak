# backend/app/routers/warnings.py
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session
from sqlalchemy.types import DateTime

from app.db import get_db
from app.schemas.warnings import WarningItem

router = APIRouter(prefix="/plan", tags=["planner"])

APP_TZ = os.getenv("APP_TZ", "UTC")

SQL = """
WITH base AS (
  SELECT
    a.id AS assignment_id, a.soldier_id, a.mission_id, a.start_at, a.end_at
  FROM assignments a
  WHERE a.start_at >= COALESCE(CAST(:from_ts AS timestamptz), '-infinity'::timestamptz)
    AND a.end_at   <= COALESCE(CAST(:to_ts   AS timestamptz),  'infinity'::timestamptz)
),
ordered_cte AS (
  SELECT
    b.*,
    LAG(b.end_at) OVER (PARTITION BY b.soldier_id ORDER BY b.start_at, b.end_at) AS prev_end_at
  FROM base b
),
overlap_cte AS (
  SELECT o.assignment_id, o.soldier_id, o.mission_id, o.start_at, o.end_at, o.prev_end_at
  FROM ordered_cte o
  WHERE o.prev_end_at IS NOT NULL
    AND o.start_at < o.prev_end_at
),
rest_cte AS (
  SELECT
    o.assignment_id, o.soldier_id, o.mission_id, o.start_at, o.end_at, o.prev_end_at,
    EXTRACT(EPOCH FROM (o.start_at - o.prev_end_at))/3600.0 AS rest_hours
  FROM ordered_cte o
  WHERE o.prev_end_at IS NOT NULL
    AND (o.start_at - o.prev_end_at) > interval '0 hours'
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

@router.get("/warnings", response_model=List[WarningItem])
def get_warnings(
    db: Session = Depends(get_db),
    from_ts: Optional[str] = Query(None, description="ISO timestamp filter, inclusive (UTC)"),
    to_ts: Optional[str]   = Query(None, description="ISO timestamp filter, inclusive (UTC)"),
):
    # Bind param types so SQLAlchemy/psycopg know these are timestamptz when non-null
    stmt = text(SQL).bindparams(
        bindparam("from_ts", type_=DateTime(timezone=True)),
        bindparam("to_ts",   type_=DateTime(timezone=True)),
        bindparam("tz"),
    )

    rows = db.execute(
        stmt,
        {"from_ts": from_ts, "to_ts": to_ts, "tz": APP_TZ},
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
