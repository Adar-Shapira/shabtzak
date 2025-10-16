# backend/app/models/mission.py
from datetime import time
from sqlalchemy import Column, Integer, String, Time
from sqlalchemy.orm import relationship
from sqlalchemy.ext.hybrid import hybrid_property
from app.db import Base

class Mission(Base):
    __tablename__ = "missions"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    start_hour = Column(Time, nullable=True)
    end_hour   = Column(Time, nullable=True)
    required_soldiers   = Column(Integer, nullable=False, default=0)
    required_commanders = Column(Integer, nullable=False, default=0)
    required_officers   = Column(Integer, nullable=False, default=0)
    required_drivers    = Column(Integer, nullable=False, default=0)

    slots = relationship(
        "MissionSlot",
        back_populates="mission",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # bridge for schema output
    @hybrid_property
    def start_time(self) -> time | None:
        return self.start_hour

    @hybrid_property
    def end_time(self) -> time | None:
        return self.end_hour

