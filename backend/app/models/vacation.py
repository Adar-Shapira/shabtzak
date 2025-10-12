from datetime import datetime, date, timezone
from sqlalchemy import ForeignKey, Date, DateTime, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base

class Vacation(Base):
    __tablename__ = "vacations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    soldier_id: Mapped[int] = mapped_column(ForeignKey("soldiers.id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date:   Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    soldier = relationship("Soldier")

# helpful index for queries
Index("ix_vacations_soldier_range", Vacation.soldier_id, Vacation.start_date, Vacation.end_date)
