# backend/app/models/__init__.py
# IMPORTANT: Use Base from app.db (not from .base) since all models import from app.db
from app.db import Base

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
from .saved_plan import SavedPlan


__all__ = [
    "Base",
    "Role",
    "Mission",
    "MissionSlot",
    "Soldier",
    "Assignment",
    "Vacation",
    "Department",
    "SavedPlan",
]
