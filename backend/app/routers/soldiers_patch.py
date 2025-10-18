from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import update, select
from sqlalchemy.orm import Session
from app.db import SessionLocal, get_db
from app.models.soldier import Soldier
from app.models.soldier_mission_restriction import SoldierMissionRestriction
from app.models.mission import Mission


router = APIRouter(prefix="/soldiers", tags=["soldiers"])

class SoldierUpdate(BaseModel):
    restrictions: str | None = None
    missions_history: str | None = None

@router.patch("/{soldier_id}", status_code=200)
def update_soldier(soldier_id: int, payload: SoldierUpdate):
    with SessionLocal() as s:
        exists = s.execute(select(Soldier.id).where(Soldier.id == soldier_id)).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="Soldier not found")

        values = {k: v for k, v in payload.model_dump().items() if v is not None}
        if not values:
            return {"id": soldier_id}

        s.execute(update(Soldier).where(Soldier.id == soldier_id).values(**values))
        s.commit()
        return {"id": soldier_id, **values}

class SoldierMissionRestrictionsOut(BaseModel):
    soldier_id: int
    mission_ids: list[int]


class SoldierMissionRestrictionsIn(BaseModel):
    mission_ids: list[int]


@router.get("/soldiers/{soldier_id}/mission_restrictions", response_model=SoldierMissionRestrictionsOut)
def get_soldier_mission_restrictions(soldier_id: int, db: Session = Depends(get_db)):
    # Validate soldier exists
    s = db.get(Soldier, soldier_id)
    if not s:
        raise HTTPException(status_code=404, detail="Soldier not found")

    rows = db.query(SoldierMissionRestriction).filter(
        SoldierMissionRestriction.soldier_id == soldier_id
    ).all()

    return SoldierMissionRestrictionsOut(
        soldier_id=soldier_id,
        mission_ids=[r.mission_id for r in rows],
    )


@router.put("/soldiers/{soldier_id}/mission_restrictions", response_model=SoldierMissionRestrictionsOut)
def put_soldier_mission_restrictions(soldier_id: int, body: SoldierMissionRestrictionsIn, db: Session = Depends(get_db)):
    # Validate soldier exists
    s = db.get(Soldier, soldier_id)
    if not s:
        raise HTTPException(status_code=404, detail="Soldier not found")

    # Validate missions exist
    if body.mission_ids:
        cnt = db.query(Mission).filter(Mission.id.in_(body.mission_ids)).count()
        if cnt != len(set(body.mission_ids)):
            raise HTTPException(status_code=400, detail="One or more missions do not exist")

    # Clear existing
    db.query(SoldierMissionRestriction).filter(
        SoldierMissionRestriction.soldier_id == soldier_id
    ).delete()

    # Insert new
    for mid in set(body.mission_ids):
        db.add(SoldierMissionRestriction(soldier_id=soldier_id, mission_id=mid))

    db.commit()

    return SoldierMissionRestrictionsOut(
        soldier_id=soldier_id,
        mission_ids=list(set(body.mission_ids)),
    )
