# backend\app\models\assignment.py
from datetime import datetime, date, time, timezone, timedelta
from sqlalchemy import ForeignKey, DateTime, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base
from zoneinfo import ZoneInfo
import os

LOCAL_TZ = ZoneInfo(os.getenv("APP_TZ", "UTC"))

class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), nullable=False)
    soldier_id: Mapped[int] = mapped_column(ForeignKey("soldiers.id"), nullable=True)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), nullable=True)

    __table_args__ = (
        # UniqueConstraint("soldier_id", "start_at", "end_at", name="uq_assignments_soldier_window"),
        Index("ix_assignments_soldier_time", "soldier_id", "start_at", "end_at"),
    )

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime]   = mapped_column(DateTime(timezone=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    mission = relationship("Mission")
    soldier = relationship("Soldier")
    role = relationship("Role")

    @staticmethod
    def window_for(mission_start: time, mission_end: time, day: date) -> tuple[datetime, datetime]:
        # build in LOCAL tz, then convert to UTC for storage
        start_local = datetime.combine(day, mission_start).replace(tzinfo=LOCAL_TZ)
        end_local = datetime.combine(day, mission_end).replace(tzinfo=LOCAL_TZ)
        if end_local <= start_local:
            end_local += timedelta(days=1)
        return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)
