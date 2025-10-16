# backend/app/schemas/mission_slot.py
from __future__ import annotations

from datetime import time
from typing import Optional
from pydantic import BaseModel, Field, model_validator

# -----------------------------
# Mission Slots (times required)
# -----------------------------
class MissionSlotBase(BaseModel):
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def check_times(self) -> "MissionSlotBase":
        # If you need overnight support, change this to `if self.start_time == self.end_time:`
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self

class MissionSlotCreate(MissionSlotBase):
    pass

class MissionSlotUpdate(BaseModel):
    start_time: Optional[time] = None
    end_time: Optional[time] = None

    @model_validator(mode="after")
    def check_times(self) -> "MissionSlotUpdate":
        if self.start_time is not None and self.end_time is not None:
            if self.end_time <= self.start_time:
                raise ValueError("end_time must be after start_time")
        return self

class MissionSlotRead(MissionSlotBase):
    id: int
    mission_id: int

    model_config = dict(from_attributes=True)
