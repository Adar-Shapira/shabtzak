# backend\app\schemas\mission_requirement.py
from typing import Optional, List
from pydantic import BaseModel, conint

class MissionRequirementBase(BaseModel):
    role_id: int
    count: conint(ge=1)

class MissionRequirementCreate(MissionRequirementBase):
    pass

class MissionRequirement(MissionRequirementBase):
    id: int
    class Config:
        from_attributes = True

class MissionRequirementsBatch(BaseModel):
    # full replace of requirements for a mission
    total_needed: Optional[conint(ge=1)] = None
    requirements: List[MissionRequirementCreate]
