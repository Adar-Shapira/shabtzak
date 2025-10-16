# backend/app/main.py
from __future__ import annotations

import os
from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Routers you already had (examples; keep what exists in your project)
from app.routers.roles import router as roles_router
from app.routers.departments import router as departments_router
from app.routers.soldiers import router as soldiers_router
from app.routers.missions import router as missions_router
from app.routers.assignments import router as assignments_router
from app.routers.planning import router as planning_router

def build_app() -> FastAPI:
    app = FastAPI(title="Shabtzak API")

    # CORS (adjust origins as you need)
    frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[frontend_origin, "http://localhost:3000", "http://127.0.0.1:5173", "http://0.0.0.0:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Health
    @app.get("/health")
    def health():
        return {"ok": True}

    # Mount existing routers
    app.include_router(roles_router)
    app.include_router(departments_router)
    app.include_router(soldiers_router)
    app.include_router(missions_router)
    app.include_router(assignments_router)
    app.include_router(planning_router)

    return app


app = build_app()
