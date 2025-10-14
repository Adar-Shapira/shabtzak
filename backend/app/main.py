from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import healthcheck
from .routers.roles import router as roles_router
from .routers.missions import router as missions_router
from .routers.soldiers import router as soldiers_router
from .routers.assignments import router as assignments_router
from .routers.vacations import router as vacations_router
#from .routers.soldiers_patch import router as soldiers_patch_router
from .routers.planning import router as planning_router
from .routers.departments import router as departments_router
import os;

app = FastAPI(title="Shabtzak API", version="0.1.0")

ENV = os.getenv("ENV", "dev").lower()
raw = os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
origins = [o.strip() for o in raw.split(",") if o.strip()]

if ENV == "dev":
    # convenient wildcard during development
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # explicit origins in prod
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/")
def root():
    return {"message": "Shabtzak API is running"}

@app.get("/status")
def status():
    try:
        healthcheck()
        return {"db": "ok"}
    except Exception as e:
        return {"db": "error", "detail": str(e)}

app.include_router(roles_router)
app.include_router(missions_router)
app.include_router(soldiers_router)
app.include_router(assignments_router)
app.include_router(vacations_router)
#app.include_router(soldiers_patch_router)
app.include_router(planning_router)
app.include_router(departments_router)
