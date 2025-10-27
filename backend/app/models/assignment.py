# backend\app\models\assignment.py
from datetime import datetime, date, time, timedelta
from sqlalchemy import ForeignKey, DateTime, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base


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

    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    end_at: Mapped[datetime]   = mapped_column(DateTime(timezone=False), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(),
        nullable=False
    )

    mission = relationship("Mission")
    soldier = relationship("Soldier")
    role = relationship("Role")

    @staticmethod
    def window_for(mission_start: time, mission_end: time, day: date) -> tuple[datetime, datetime]:
        """
        Build naive datetimes from a day + mission slot times (no timezone math).
        If end <= start, roll end by +1 day.
        """
        start_dt = datetime.combine(day, mission_start)
        end_dt   = datetime.combine(day, mission_end)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)
        return start_dt, end_dt
