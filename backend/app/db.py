# backend/app/db.py
import os
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# --- SQLAlchemy Base ---------------------------------------------------------
class Base(DeclarativeBase):
    pass

# --- Engine / Session --------------------------------------------------------
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://shabtzak:devpass@db:5432/shabtzak",
)

# SQLite-specific engine configuration
if DATABASE_URL.startswith("sqlite"):
    # SQLite doesn't support pool_pre_ping, and needs check_same_thread=False for SQLAlchemy 2.0
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        echo=False,
    )
else:
    # PostgreSQL/other databases
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    future=True,
)

# FastAPI dependency
def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Used by app.main during startup and/​or /health route
def healthcheck() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}
