# backend/app/schemas/mission_slot.py
from __future__ import annotations
from datetime import time
from typing import Optional
from pydantic import BaseModel
from pydantic.config import ConfigDict
from pydantic import field_validator

class MissionSlotCreate(BaseModel):
    start_time: time
    end_time: time

    @field_validator("end_time")
    @classmethod
    def _must_differ(cls, end, info):
        start = info.data.get("start_time")
        if start and end == start:
            raise ValueError("end_time must differ from start_time")
        # allow overnight (end < start)
        return end

class MissionSlotUpdate(BaseModel):
    start_time: Optional[time] = None
    end_time: Optional[time] = None

    @field_validator("end_time")
    @classmethod
    def _must_differ_if_both_present(cls, end, info):
        start = info.data.get("start_time")
        if start is not None and end is not None and end == start:
            raise ValueError("end_time must differ from start_time")
        return end

class MissionSlotRead(BaseModel):
    id: int
    mission_id: int
    start_time: time
    end_time: time

    model_config = ConfigDict(from_attributes=True)
