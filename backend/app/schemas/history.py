# backend\app\schemas\history.py
from datetime import date, time
from typing import List, Optional
from pydantic import BaseModel


class MissionHistoryItem(BaseModel):
    mission_id: int
    mission_name: str
    slot_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    fellow_soldiers: List[str]
