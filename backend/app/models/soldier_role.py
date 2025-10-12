from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base

class SoldierRole(Base):
    __tablename__ = "soldier_roles"

    soldier_id: Mapped[int] = mapped_column(ForeignKey("soldiers.id"), primary_key=True)
    role_id:    Mapped[int] = mapped_column(ForeignKey("roles.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (UniqueConstraint("soldier_id", "role_id", name="uq_soldier_role"),)
