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
  -- Keep only assignments that START on the selected day
  SELECT *
  FROM ordered_cte
  WHERE (start_at::date = :day_date)
),
overlap_cte AS (
  SELECT
    o.assignment_id, o.soldier_id, o.mission_id, o.start_at, o.end_at, o.prev_end_at
  FROM base o
  WHERE o.prev_end_at IS NOT NULL
    AND o.start_at < o.prev_end_at
    -- only warn for assignments that START on the selected day
    AND (o.start_at::date = :day_date)
),
rest_cte AS (
  SELECT
    o.assignment_id, o.soldier_id, o.mission_id, o.start_at, o.end_at, o.prev_end_at,
    EXTRACT(EPOCH FROM (o.start_at - o.prev_end_at))/3600.0 AS rest_hours
  FROM base o
  WHERE o.prev_end_at IS NOT NULL
    AND (o.start_at - o.prev_end_at) >= interval '0 hours'
    AND (o.start_at - o.prev_end_at) < interval '8 hours'
    -- only warn for assignments that START on the selected day
    AND (o.start_at::date = :day_date)
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
    -- only warn for assignments that START on the selected day
    AND (r.start_at::date = :day_date)
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
    -- only warn for assignments that START on the selected day
    AND (r.start_at::date = :day_date)
),
restricted_cte AS (
  -- Check both the soldier_mission_restrictions table AND the soldiers.restrictions string field
  SELECT DISTINCT
    b.assignment_id, b.soldier_id, b.mission_id, b.start_at, b.end_at
  FROM base b
  JOIN soldiers s ON s.id = b.soldier_id
  JOIN missions m ON m.id = b.mission_id
  WHERE (
    -- Check table-based restrictions
    EXISTS (
      SELECT 1 FROM soldier_mission_restrictions r
      WHERE r.soldier_id = b.soldier_id AND r.mission_id = b.mission_id
    )
    OR
    -- Check string-based restrictions (comma or semicolon separated mission names)
    (s.restrictions IS NOT NULL AND s.restrictions != '' AND (
      -- Split restrictions string by comma/semicolon, normalize (lowercase, trim), and check if mission name is in the array
      LOWER(TRIM(m.name)) IN (
        SELECT LOWER(TRIM(unnest(string_to_array(REPLACE(s.restrictions, ';', ','), ','))))
      )
    ))
  )
)
-- RESTRICTED (keep same; orange)
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
    restricted_count = 0
    import logging
    
    # Debug: Check what warning types we got from SQL
    warning_types_from_sql = {}
    for r in rows:
        wtype = r.get("type")
        warning_types_from_sql[wtype] = warning_types_from_sql.get(wtype, 0) + 1
    print(f"[WARNINGS] Warnings from SQL for {day}: {warning_types_from_sql}, total={len(rows)}")
    logging.info(f"Warnings from SQL for {day}: {warning_types_from_sql}, total={len(rows)}")
    
    # Debug: Check if we have any restricted assignments for this day before filtering
    restricted_before_filter = [r for r in rows if r.get("type") == "RESTRICTED"]
    if len(restricted_before_filter) > 0:
        logging.info(f"Found {len(restricted_before_filter)} RESTRICTED warnings before Python filter: {[(r.get('soldier_name'), r.get('mission_name'), r.get('assignment_id')) for r in restricted_before_filter[:5]]}")
    else:
        logging.info(f"No RESTRICTED warnings found in SQL query for {day}")
        
        # Debug: Check if there are any restricted assignments in base CTE at all
        debug_query = text("""
            WITH base AS (
                SELECT a.id AS assignment_id, a.soldier_id, a.mission_id, a.start_at, a.start_at::date as start_date
                FROM assignments a
                WHERE (a.start_at::date = :day_date)
            ),
            restricted_check AS (
                SELECT b.assignment_id, b.soldier_id, b.mission_id, b.start_at, b.start_date
                FROM base b
                JOIN soldier_mission_restrictions r
                    ON r.soldier_id = b.soldier_id
                    AND r.mission_id = b.mission_id
            )
            SELECT 
                COUNT(*) as restricted_count,
                array_agg(assignment_id) as assignment_ids,
                array_agg(soldier_id) as soldier_ids,
                array_agg(mission_id) as mission_ids
            FROM restricted_check
        """)
        
        # Also check: are there ANY restricted assignments (regardless of date)?
        debug_query_all = text("""
            SELECT 
                COUNT(*) as total_restricted,
                COUNT(DISTINCT a.id) as restricted_assignment_count,
                array_agg(DISTINCT a.id) FILTER (WHERE a.start_at::date = :day_date) as restricted_today_ids,
                array_agg(DISTINCT a.id) as all_restricted_assignment_ids,
                array_agg(DISTINCT a.start_at::date) as restricted_dates
            FROM assignments a
            JOIN soldier_mission_restrictions r
                ON r.soldier_id = a.soldier_id
                AND r.mission_id = a.mission_id
        """)
        
        # Also check: how many restrictions exist in the table?
        debug_restrictions_count = text("SELECT COUNT(*) as count FROM soldier_mission_restrictions")
        try:
            debug_result = db.execute(debug_query, {"day_date": day_date}).mappings().first()
            if debug_result:
                print(f"[WARNINGS DEBUG] Found {debug_result['restricted_count']} restricted assignments for {day_date}")
                print(f"[WARNINGS DEBUG] Assignment IDs: {debug_result.get('assignment_ids')}, Soldier IDs: {debug_result.get('soldier_ids')}, Mission IDs: {debug_result.get('mission_ids')}")
                logging.info(f"Debug: Found {debug_result['restricted_count']} restricted assignments for {day_date}")
                logging.info(f"Debug: Assignment IDs: {debug_result.get('assignment_ids')}, Soldier IDs: {debug_result.get('soldier_ids')}, Mission IDs: {debug_result.get('mission_ids')}")
            else:
                print(f"[WARNINGS DEBUG] No restricted assignments found for {day_date}")
                logging.warning(f"Debug: No restricted assignments found for {day_date}")
            
            # Check if there are ANY restricted assignments in the database
            debug_all_result = db.execute(debug_query_all, {"day_date": day_date}).mappings().first()
            if debug_all_result:
                print(f"[WARNINGS DEBUG] Total restricted assignments in DB: {debug_all_result.get('total_restricted')}")
                print(f"[WARNINGS DEBUG] Restricted assignments today: {debug_all_result.get('restricted_today_ids')}")
                print(f"[WARNINGS DEBUG] All restricted assignment IDs: {debug_all_result.get('all_restricted_assignment_ids')}")
                print(f"[WARNINGS DEBUG] Dates of restricted assignments: {debug_all_result.get('restricted_dates')}")
                logging.info(f"Debug: Total restricted assignments: {debug_all_result.get('total_restricted')}, Today: {debug_all_result.get('restricted_today_ids')}")
            
            # Check how many restrictions exist
            restrictions_count = db.execute(debug_restrictions_count).scalar()
            print(f"[WARNINGS DEBUG] Total restriction records in soldier_mission_restrictions table: {restrictions_count}")
            logging.info(f"Debug: Total restriction records: {restrictions_count}")
            
            # Also check: are there soldiers with restrictions in the string field?
            debug_string_restrictions = text("""
                SELECT COUNT(*) as count, 
                       array_agg(DISTINCT id) as soldier_ids_with_restrictions
                FROM soldiers
                WHERE restrictions IS NOT NULL AND restrictions != ''
            """)
            string_restrictions_result = db.execute(debug_string_restrictions).mappings().first()
            if string_restrictions_result:
                print(f"[WARNINGS DEBUG] Soldiers with restrictions string field: {string_restrictions_result.get('count')}")
                print(f"[WARNINGS DEBUG] Soldier IDs with restrictions: {string_restrictions_result.get('soldier_ids_with_restrictions')}")
            
            # Debug: check what restrictions string contains and what assignments exist for those soldiers
            debug_restrictions_detail = text("""
                SELECT s.id as soldier_id, s.name as soldier_name, s.restrictions,
                       array_agg(DISTINCT a.id) as assignment_ids,
                       array_agg(DISTINCT m.name) as mission_names
                FROM soldiers s
                LEFT JOIN assignments a ON a.soldier_id = s.id AND (a.start_at::date = :day_date)
                LEFT JOIN missions m ON m.id = a.mission_id
                WHERE s.restrictions IS NOT NULL AND s.restrictions != ''
                GROUP BY s.id, s.name, s.restrictions
            """)
            restrictions_detail_rows = db.execute(debug_restrictions_detail, {"day_date": day_date}).mappings().all()
            for row in restrictions_detail_rows:
                print(f"[WARNINGS DEBUG] Soldier {row['soldier_name']} (ID {row['soldier_id']}): restrictions='{row['restrictions']}', assignments={row['assignment_ids']}, missions={row['mission_names']}")
        except Exception as e:
            print(f"[WARNINGS DEBUG ERROR] Debug query failed: {e}")
            import traceback
            print(f"[WARNINGS DEBUG ERROR] Traceback: {traceback.format_exc()}")
            logging.warning(f"Debug query failed: {e}")
    
    for r in rows:
        # Convert datetime to isoformat string (no timezone)
        start_at_val = r["start_at_local"]
        end_at_val = r["end_at_local"]
        
        # Filter: only include warnings for assignments that start on the selected day
        # Simple date comparison without timezone conversion
        if isinstance(start_at_val, datetime):
            warning_date = start_at_val.date()
            if warning_date != day_date:
                logging.warning(f"Filtering out warning for wrong day: Type={r['type']}, soldier={r['soldier_name']}, start_at={start_at_val.isoformat()}, date={warning_date}, expected={day_date}")
                continue
        
        start_at_str = start_at_val.isoformat(timespec="seconds") if isinstance(start_at_val, datetime) else str(start_at_val)
        end_at_str = end_at_val.isoformat(timespec="seconds") if isinstance(end_at_val, datetime) else str(end_at_val)
        
        if r["type"] == "RESTRICTED":
            restricted_count += 1
            logging.info(f"RESTRICTED warning: soldier={r['soldier_name']}, mission={r['mission_name']}, level={r.get('level')}, assignment_id={r.get('assignment_id')}, start_at={start_at_str}")
        
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
    
    # Debug: log total counts
    total_by_type = {}
    for r in rows:
        total_by_type[r["type"]] = total_by_type.get(r["type"], 0) + 1
    logging.info(f"Warnings returned for {day}: total={len(out)}, by_type={total_by_type}, RESTRICTED_count={restricted_count}")

    return out
