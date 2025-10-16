# backend/app/main.py
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import Base, engine, healthcheck
# Import models so they register on Base.metadata
import app.models  # noqa: F401 (imports __all__ which imports every model)

# Routers
from app.routers.roles import router as roles_router
from app.routers.departments import router as departments_router
from app.routers.soldiers import router as soldiers_router
from app.routers.missions import router as missions_router

app = FastAPI(title="Shabtzak API")

# CORS
origins = [o.strip() for o in os.getenv("FRONTEND_ORIGINS", "").split(",") if o.strip()]
if origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Startup: create tables if they don't exist
@app.on_event("startup")
def on_startup() -> None:
    # sanity probe the DB
    healthcheck()
    # create tables (safe if already there)
    Base.metadata.create_all(bind=engine)

# Simple health endpoint (optional, but handy)
@app.get("/health")
def health():
    return healthcheck()

# Routers
app.include_router(roles_router)
app.include_router(departments_router)
app.include_router(soldiers_router)
app.include_router(missions_router)
