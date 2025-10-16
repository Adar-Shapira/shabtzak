# backend/scripts/create_tables.py
import os
# trust the already-set env var; optional: default fallback
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:devpass@127.0.0.1:5432/shabtzak"
)

from sqlalchemy import inspect
from app.db import engine, Base

# IMPORTANT: import every model module so the tables are registered on Base.metadata
from app.models import mission, mission_slot, soldier, role, assignment  # and any junction tables (e.g., soldier_role)

Base.metadata.create_all(bind=engine)

# Show what was actually created
insp = inspect(engine)
print("tables:", insp.get_table_names(schema=None))
