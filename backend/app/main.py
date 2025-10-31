# backend/app/main.py
from __future__ import annotations

import os
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.engine import URL

# Routers you already had (examples; keep what exists in your project)
from app.routers.roles import router as roles_router
from app.routers.departments import router as departments_router
from app.routers.soldiers import router as soldiers_router
from app.routers.missions import router as missions_router
from app.routers.assignments import router as assignments_router
from app.routers.planning import router as planning_router
from app.routers.mission_requirements import router as mission_requirements_router
from app.routers.vacations import router as vacations_router
from app.routers import mission_history
from app.routers import warnings as warnings_router
from app.routers.saved_plans import router as saved_plans_router

from app.db import engine, Base as DBBase
from app import models  # ensure all models are imported and registered on Base.metadata


def build_app() -> FastAPI:
    import logging
    import sys
    # Configure logging to handle encoding properly
    # Only configure if not already configured
    if not logging.root.handlers:
        logging.basicConfig(
            level=logging.INFO,
            format='%(message)s',
            stream=sys.stdout,
            encoding='utf-8'
        )
    
    app = FastAPI(title="Shabtzak API")

    # CORS (adjust origins as you need)
    # Allow all origins for Tauri app (localhost with any port)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins for Tauri desktop app
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=600,
    )

    # Health
    @app.get("/health")
    def health():
        from app.db import engine
        from sqlalchemy import inspect
        try:
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            return {
                "ok": True,
                "database_url": os.getenv("DATABASE_URL", "NOT SET"),
                "tables": tables,
                "table_count": len(tables)
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # On startup, ensure tables exist (especially for embedded SQLite)
    @app.on_event("startup")
    def _startup_create_tables() -> None:
        try:
            print(f"[startup] Database URL: {os.getenv('DATABASE_URL', 'NOT SET')}")
            print(f"[startup] Creating database tables...")
            # Use DBBase (from app.db) which is the same Base all models use
            # Import models to ensure they're registered
            _ = models  # Force import
            
            # Create tables if they don't exist (for embedded SQLite)
            DBBase.metadata.create_all(bind=engine)
            print(f"[startup] Tables created successfully!")
            
            # Verify tables exist by listing them
            from sqlalchemy import inspect
            inspector = inspect(engine)
            tables = inspector.get_table_names()
            print(f"[startup] Available tables: {', '.join(tables) if tables else 'NONE'}")
        except Exception as e:
            # Don't crash if migrations are preferred; just log
            import traceback
            print(f"[startup] create_all failed: {e}")
            print(f"[startup] Traceback: {traceback.format_exc()}")

    # Mount existing routers
    app.include_router(roles_router)
    app.include_router(departments_router)
    app.include_router(soldiers_router)
    app.include_router(missions_router)
    app.include_router(assignments_router)
    app.include_router(planning_router)
    app.include_router(mission_requirements_router)
    app.include_router(vacations_router)
    app.include_router(mission_history.router)
    app.include_router(warnings_router.router)
    app.include_router(saved_plans_router)

    return app


app = build_app()
