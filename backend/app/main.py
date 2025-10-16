# backend/app/main.py
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import Base, engine, healthcheck
# Import models so they register on Base.metadata
import app.models  # noqa: F401

# Routers
from app.routers.roles import router as roles_router
from app.routers.departments import router as departments_router
from app.routers.soldiers import router as soldiers_router
from app.routers.missions import router as missions_router
from app.routers.mission_requirements import router as mission_requirements_router

app = FastAPI(title="Shabtzak API")

# --- CORS --------------------------------------------------------------------
# Allow the Vite dev server by default; can be overridden via FRONTEND_ORIGINS
DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",      # vite preview
    "http://127.0.0.1:4173",
]

env_origins = [o.strip() for o in os.getenv("FRONTEND_ORIGINS", "").split(",") if o.strip()]
allowed_origins = env_origins if env_origins else DEFAULT_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",  # catch other local ports
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# --- Startup -----------------------------------------------------------------
@app.on_event("startup")
def on_startup() -> None:
    # sanity probe the DB
    healthcheck()

# --- Health ------------------------------------------------------------------
@app.get("/health")
def health():
    return healthcheck()

# --- Routers -----------------------------------------------------------------
app.include_router(roles_router)
app.include_router(departments_router)
app.include_router(soldiers_router)
app.include_router(missions_router)
app.include_router(mission_requirements_router)
