# backend/app/models/__init__.py
from .base import Base

# import all model modules so tables get registered on Base.metadata
# (Adjust these imports to match the actual files you have)
from .role import Role
from .mission import Mission
from .mission_slot import MissionSlot
from .soldier import Soldier
from .soldier_role import SoldierRole
from .assignment import Assignment
from .vacation import Vacation
from .department import Department
from .mission_requirement import MissionRequirement
from .soldier_mission_restriction import SoldierMissionRestriction


__all__ = [
    "Base",
    "Role",
    "Mission",
    "MissionSlot",
    "Soldier",
    "Assignment",
    "Vacation",
    "Department",
]
