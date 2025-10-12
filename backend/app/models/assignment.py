from datetime import datetime, date, time, timezone, timedelta
from sqlalchemy import ForeignKey, DateTime, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base

    
class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), nullable=False)
    soldier_id: Mapped[int] = mapped_column(ForeignKey("soldiers.id"), nullable=False)

    __table_args__ = (
        UniqueConstraint("soldier_id", "start_at", "end_at", name="uq_assignments_soldier_window"),
        Index("ix_assignments_soldier_time", "soldier_id", "start_at", "end_at"),
    )

    # We store concrete shift window for overlap checks (tz-aware)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime]   = mapped_column(DateTime(timezone=True), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )

    mission = relationship("Mission")
    soldier = relationship("Soldier")

    @staticmethod
    def window_for(mission_start: time, mission_end: time, day: date) -> tuple[datetime, datetime]:
        """Build absolute datetimes for a mission on a specific calendar day (supports overnight)."""
        start_dt = datetime.combine(day, mission_start).replace(tzinfo=timezone.utc)
        end_dt = datetime.combine(day, mission_end).replace(tzinfo=timezone.utc)
        if end_dt <= start_dt:
            end_dt += timedelta(days=1)  # overnight (wrap past midnight)
        return start_dt, end_dt
