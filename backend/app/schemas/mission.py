# backend\app\schemas\mission.py
from typing import Optional
from pydantic import BaseModel

class MissionBase(BaseModel):
    name: str
    total_needed: Optional[int] = None

class MissionCreate(MissionBase):
    pass

class MissionUpdate(BaseModel):
    name: Optional[str] = None
    total_needed: Optional[int] = None
    order: Optional[int] = None

class MissionOut(BaseModel):
    id: int
    name: str
    total_needed: Optional[int] = None
    order: int

    class Config:
        from_attributes = True
