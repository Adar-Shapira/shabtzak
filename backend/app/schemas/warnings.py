# backend\app\schemas\warnings.py
from typing import Literal, Optional
from pydantic import BaseModel


WarningType = Literal["RESTRICTED", "OVERLAP", "REST", "NOT_FRIENDS"]

class WarningItem(BaseModel):
    type: WarningType
    soldier_id: int
    soldier_name: str
    mission_id: int
    mission_name: str
    start_at: str
    end_at: str
    details: Optional[str] = None
    assignment_id: Optional[int] = None
    level : str | None = None
