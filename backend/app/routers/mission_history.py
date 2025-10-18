# backend\app\routers\mission_history.py
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.history import MissionHistoryItem

import os

APP_TZ = os.getenv("APP_TZ", "UTC")
router = APIRouter(prefix="/soldiers", tags=["soldiers"])

SQL = """
SELECT
  a.mission_id AS mission_id,
  m.name       AS mission_name,
  (a.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date AS slot_date,
  (a.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::time AS start_time,
  (a.end_at   AT TIME ZONE 'UTC' AT TIME ZONE :tz)::time AS end_time,
  ARRAY_AGG(f.name) FILTER (
    WHERE a2.soldier_id IS NOT NULL AND a2.soldier_id <> :soldier_id
  ) AS fellow_soldiers
FROM assignments a
JOIN missions m ON m.id = a.mission_id
LEFT JOIN assignments a2
  ON a2.mission_id = a.mission_id
  AND a2.start_at  = a.start_at
  AND a2.end_at    = a.end_at
LEFT JOIN soldiers f ON f.id = a2.soldier_id
WHERE a.soldier_id = :soldier_id
GROUP BY a.mission_id, m.name,
         (a.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date,
         (a.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::time,
         (a.end_at   AT TIME ZONE 'UTC' AT TIME ZONE :tz)::time
ORDER BY
  (a.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date DESC NULLS LAST,
  (a.start_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::time DESC NULLS LAST,
  m.name ASC
"""


@router.get("/{soldier_id}/mission-history", response_model=List[MissionHistoryItem])
def get_mission_history(soldier_id: int, db: Session = Depends(get_db)):
    exists = db.execute(text("SELECT 1 FROM soldiers WHERE id = :sid LIMIT 1"), {"sid": soldier_id}).first()
    if not exists:
        raise HTTPException(status_code=404, detail="Soldier not found")

    rows = db.execute(text(SQL), {"soldier_id": soldier_id, "tz": APP_TZ}).mappings().all()

    cleaned: List[MissionHistoryItem] = []
    for r in rows:
        fellows = [x for x in (r.get("fellow_soldiers") or []) if x and x.strip()]
        unique_fellows = sorted(set(fellows))
        cleaned.append(
            MissionHistoryItem(
                mission_id=r["mission_id"],
                mission_name=r["mission_name"],
                slot_date=r.get("slot_date"),
                start_time=r.get("start_time"),
                end_time=r.get("end_time"),
                fellow_soldiers=unique_fellows,
            )
        )
    return cleaned
