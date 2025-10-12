from datetime import datetime, time, timezone
from sqlalchemy import String, Integer, Time, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base

class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    start_hour: Mapped[time] = mapped_column(Time, nullable=False)
    end_hour: Mapped[time] = mapped_column(Time, nullable=False)
    required_soldiers: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    required_commanders: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    required_officers: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    required_drivers: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
