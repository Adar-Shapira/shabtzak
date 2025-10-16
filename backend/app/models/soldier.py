# backend/app/models/soldier.py
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base

class Soldier(Base):
    __tablename__ = "soldiers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)

    # No primary role anymore
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)

    restrictions: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    missions_history: Mapped[str] = mapped_column(String(256), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    department = relationship("Department")

    # Many-to-many roles
    roles = relationship("Role", secondary="soldier_roles", lazy="selectin")

    @property
    def role_names(self) -> list[str]:
        return sorted({r.name for r in (self.roles or [])})
