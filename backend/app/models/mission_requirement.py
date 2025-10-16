# backend\app\models\mission_requirement.py
from sqlalchemy import Column, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db import Base

class MissionRequirement(Base):
    __tablename__ = "mission_requirements"

    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    count = Column(Integer, nullable=False, default=1)

    # Use string names to avoid circular imports
    mission = relationship("Mission", backref="requirements")
    role = relationship("Role")

    __table_args__ = (
        UniqueConstraint("mission_id", "role_id", name="uq_mission_role_once"),
    )
