# backend/app/schemas/mission.py
from datetime import datetime, time
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, field_serializer

class MissionCreate(BaseModel):
    name: str
    required_soldiers: int = 0
    required_commanders: int = 0
    required_officers: int = 0
    required_drivers: int = 0
    # Optional – allow creating without times
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

class MissionUpdate(BaseModel):
    name: Optional[str] = None
    required_soldiers: Optional[int] = None
    required_commanders: Optional[int] = None
    required_officers: Optional[int] = None
    required_drivers: Optional[int] = None
    # Optional and individually updatable
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

class MissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    required_soldiers: int
    required_commanders: int
    required_officers: int
    required_drivers: int

    # We’ll expose times as HH:MM (coming from model properties below)
    start_time: Optional[time] = None
    end_time: Optional[time] = None

    @field_serializer("start_time")
    def _ser_start(self, v: Optional[time], _info):
        return v.strftime("%H:%M") if v else None

    @field_serializer("end_time")
    def _ser_end(self, v: Optional[time], _info):
        return v.strftime("%H:%M") if v else None
