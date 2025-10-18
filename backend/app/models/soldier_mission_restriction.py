# backend/app/models/soldier_mission_restriction.py
from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db import Base

class SoldierMissionRestriction(Base):
    __tablename__ = "soldier_mission_restrictions"

    id = Column(Integer, primary_key=True)
    soldier_id = Column(Integer, ForeignKey("soldiers.id", ondelete="CASCADE"), nullable=False)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)

    soldier = relationship("Soldier", back_populates="mission_restrictions")
    mission = relationship("Mission")

    __table_args__ = (
        UniqueConstraint("soldier_id", "mission_id", name="uq_soldier_mission_restriction"),
    )
