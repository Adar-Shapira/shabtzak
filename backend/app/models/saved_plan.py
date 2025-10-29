# backend/app/models/saved_plan.py
from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, JSON
from app.db import Base

class SavedPlan(Base):
    __tablename__ = "saved_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    day = Column(String, nullable=False)  # YYYY-MM-DD
    plan_data = Column(JSON, nullable=False)  # Stores assignments, excluded_slots, locked_assignments
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)

