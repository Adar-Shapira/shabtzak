# backend/app/schemas/mission.py
from typing import Optional
from pydantic import BaseModel, ConfigDict

class MissionCreate(BaseModel):
    name: str
    total_needed: Optional[int] = None

class MissionUpdate(BaseModel):
    name: Optional[str] = None
    total_needed: Optional[int] = None

class MissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    total_needed: Optional[int] = None
