# backend\app\models\mission.py
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from app.db import Base

class Mission(Base):
    __tablename__ = "missions"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    total_needed = Column(Integer, nullable=True)
    order = Column(Integer, nullable=False, default=0)

    slots = relationship(
        "MissionSlot",
        back_populates="mission",
        cascade="all, delete-orphan",
    )
    requirements = relationship(
        "MissionRequirement",
        back_populates="mission",
        cascade="all, delete-orphan",
    )
