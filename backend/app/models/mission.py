# backend/app/models/mission.py
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from app.db import Base

class Mission(Base):
    __tablename__ = "missions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    total_needed = Column(Integer, nullable=True)

    # Relationships
    slots = relationship(
        "MissionSlot",
        back_populates="mission",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # requirements are provided by MissionRequirement.mission backref
    # (defined in app/models/mission_requirement.py)
