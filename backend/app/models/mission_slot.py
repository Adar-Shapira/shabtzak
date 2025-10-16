# backend/app/models/mission_slot.py
from __future__ import annotations

from datetime import time
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy import Integer, Time, ForeignKey, UniqueConstraint, Index

from app.db import Base


class MissionSlot(Base):
    __tablename__ = "mission_slots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mission_id: Mapped[int] = mapped_column(
        ForeignKey("missions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    __table_args__ = (
        UniqueConstraint("mission_id", "start_time", "end_time", name="uq_mission_slot_range"),
        Index("ix_mission_slots_mission_start", "mission_id", "start_time"),
    )

    mission = relationship("Mission", back_populates="slots")
