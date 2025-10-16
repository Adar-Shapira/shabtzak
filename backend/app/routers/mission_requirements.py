# backend\app\routers\mission_requirements.py
from fastapi import APIRouter, HTTPException, Depends, Path
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Mission, Role, MissionRequirement
from app.schemas.mission_requirement import MissionRequirement as MissionRequirementSchema
from app.schemas.mission_requirement import MissionRequirementsBatch

router = APIRouter(prefix="/missions", tags=["missions:requirements"])

@router.get("/{mission_id}/requirements", response_model=MissionRequirementsBatch)
def list_requirements(mission_id: int = Path(..., ge=1), db: Session = Depends(get_db)):
    mission = db.query(Mission).get(mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")

    reqs = db.query(MissionRequirement).filter_by(mission_id=mission_id).all()
    return {
        "total_needed": mission.total_needed,
        "requirements": [{"role_id": r.role_id, "count": r.count} for r in reqs],
    }

@router.put("/{mission_id}/requirements", response_model=MissionRequirementsBatch)
def replace_requirements(
    payload: MissionRequirementsBatch,
    mission_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
):
    mission = db.query(Mission).get(mission_id)
    if not mission:
        raise HTTPException(404, "Mission not found")

    # validate roles exist
    role_ids = {r.role_id for r in payload.requirements}
    if role_ids:
        existing = {r.id for r in db.query(Role.id).filter(Role.id.in_(role_ids)).all()}
        missing = role_ids - existing
        if missing:
            raise HTTPException(400, f"Unknown role ids: {sorted(missing)}")

    # optional sum validation vs total_needed
    if payload.total_needed is not None:
        mission.total_needed = payload.total_needed

    sum_counts = sum(r.count for r in payload.requirements)
    if mission.total_needed is not None and sum_counts > mission.total_needed:
        raise HTTPException(400, "Sum of role counts exceeds total_needed")

    # replace set atomically
    db.query(MissionRequirement).filter_by(mission_id=mission_id).delete()
    to_add = [
        MissionRequirement(mission_id=mission_id, role_id=r.role_id, count=r.count)
        for r in payload.requirements
    ]
    db.add_all(to_add)
    db.commit()

    # return batch shape
    return {
        "total_needed": mission.total_needed,
        "requirements": [{"role_id": r.role_id, "count": r.count} for r in to_add],
    }

