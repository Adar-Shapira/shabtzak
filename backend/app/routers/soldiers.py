# backend/app/routers/soldiers.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional, List, Union
from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models.soldier import Soldier
from app.models.role import Role
from app.models.department import Department
from app.models.soldier_role import SoldierRole
from app.models.assignment import Assignment                 
from app.models.vacation import Vacation    

from sqlalchemy.orm import selectinload

from sqlalchemy.orm import selectinload, joinedload  # add this import
from app.models.soldier_mission_restriction import SoldierMissionRestriction  # add
from app.models.mission import Mission  # optional, but nice to have the type


router = APIRouter(prefix="/soldiers", tags=["soldiers"])

def _normalize_restrictions(value: Union[str, List[str], None]) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        toks, seen = [], set()
        for t in value:
            t = (t or "").strip()
            if t and t.lower() not in seen:
                seen.add(t.lower()); toks.append(t)
        return ",".join(toks)
    return value.strip()

class SoldierIn(BaseModel):
    name: str
    role_ids: List[int] = []             # multiple roles (can be empty)
    department_id: Optional[int] = None
    restrictions: Union[str, List[str]] = ""
    missions_history: str = ""

    @field_validator("role_ids")
    @classmethod
    def dedup_roles(cls, v):
        out, seen = [], set()
        for x in (v or []):
            if x not in seen:
                seen.add(x); out.append(x)
        return out

class SoldierUpdate(BaseModel):
    name: Optional[str] = None
    role_ids: Optional[List[int]] = None  # replace full set if provided
    department_id: Optional[int] = None
    restrictions: Optional[Union[str, List[str]]] = None

@router.get("")
def list_soldiers():
    with SessionLocal() as s:
        rows = (
            s.execute(
                select(Soldier)
                .options(
                    selectinload(Soldier.roles),
                    selectinload(Soldier.department),
                    # Eager-load the restriction rows AND their mission to avoid detached access
                    selectinload(Soldier.mission_restrictions).selectinload(
                        SoldierMissionRestriction.mission
                    ),
                )
                .order_by(Soldier.id)
            )
            .scalars()
            .all()
        )

        out = []
        for x in rows:
            out.append({
                "id": x.id,
                "name": x.name,
                "roles": [{"id": r.id, "name": r.name} for r in (x.roles or [])],
                "department_id": x.department_id,
                "department_name": x.department.name if x.department else None,

                # keep original string field
                "restrictions": x.restrictions,
                "restrictions_tokens": [
                    t.strip()
                    for t in x.restrictions.replace(";", ",").split(",")
                    if t.strip()
                ],

                # IMPORTANT: return only scalars, never ORM objects
                "mission_restrictions": [
                    {
                        "mission_id": mr.mission_id,
                        "mission_name": (mr.mission.name if mr.mission else None),
                    }
                    for mr in (x.mission_restrictions or [])
                ],
                "mission_restriction_ids": [
                    mr.mission_id for mr in (x.mission_restrictions or [])
                ],

                "missions_history": x.missions_history,
            })
        return out

@router.post("", status_code=201)
def create_soldier(payload: SoldierIn):
    with SessionLocal() as s:
        # validate roles
        for rid in payload.role_ids:
            if s.execute(select(Role.id).where(Role.id == rid)).scalar_one_or_none() is None:
                raise HTTPException(status_code=400, detail=f"role_id {rid} does not exist")
        # validate department
        if payload.department_id is not None:
            if s.execute(select(Department.id).where(Department.id == payload.department_id)).scalar_one_or_none() is None:
                raise HTTPException(status_code=400, detail="department_id does not exist")
        try:
            new_id = s.execute(
                insert(Soldier).values(
                    name=payload.name.strip(),
                    department_id=payload.department_id,
                    restrictions=_normalize_restrictions(payload.restrictions),
                    missions_history=payload.missions_history
                ).returning(Soldier.id)
            ).scalar_one()
            # set roles
            for rid in payload.role_ids:
                s.execute(insert(SoldierRole).values(soldier_id=new_id, role_id=rid))
            s.commit()
            return {"id": new_id}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Soldier name already exists")

@router.patch("/{soldier_id}")
def update_soldier(soldier_id: int, payload: SoldierUpdate):
    with SessionLocal() as s:
        soldier = s.execute(select(Soldier).where(Soldier.id == soldier_id)).scalar_one_or_none()
        if not soldier:
            raise HTTPException(status_code=404, detail="Soldier not found")

        # Build field updates
        values = {}
        if payload.name is not None:
            values["name"] = payload.name.strip()

        if payload.department_id is not None:
            if payload.department_id == 0:
                values["department_id"] = None
            else:
                exists = s.execute(
                    select(Department.id).where(Department.id == payload.department_id)
                ).scalar_one_or_none()
                if exists is None:
                    raise HTTPException(status_code=400, detail="department_id does not exist")
                values["department_id"] = payload.department_id

        if payload.restrictions is not None:
            values["restrictions"] = _normalize_restrictions(payload.restrictions)

        try:
            # Apply simple column updates first (if any)
            if values:
                s.execute(update(Soldier).where(Soldier.id == soldier_id).values(**values))

            # Replace roles if provided
            if payload.role_ids is not None:
                # validate all role IDs exist
                for rid in payload.role_ids:
                    ok = s.execute(select(Role.id).where(Role.id == rid)).scalar_one_or_none()
                    if ok is None:
                        raise HTTPException(status_code=400, detail=f"role_id {rid} does not exist")

                # replace set
                s.execute(delete(SoldierRole).where(SoldierRole.soldier_id == soldier_id))
                for rid in payload.role_ids:
                    s.execute(insert(SoldierRole).values(soldier_id=soldier_id, role_id=rid))

            s.commit()
            return {"id": soldier_id}

        except IntegrityError:
            s.rollback()
            # most likely unique constraint on Soldier.name
            raise HTTPException(status_code=409, detail="Soldier name already exists")

@router.delete("/{soldier_id}", status_code=204)
def delete_soldier(soldier_id: int):
    """
    Deletes a soldier if they have no assignments.
    Cleans up soldier_roles and vacations to avoid orphans.
    """
    with SessionLocal() as s:
        # Block if soldier has any assignments
        asg_count = s.execute(
            select(func.count()).select_from(Assignment).where(Assignment.soldier_id == soldier_id)
        ).scalar_one()
        if asg_count:
            raise HTTPException(status_code=400, detail="Soldier has assignments; clear them first")

        # Ensure the soldier exists
        exists = s.execute(select(Soldier.id).where(Soldier.id == soldier_id)).scalar_one_or_none()
        if not exists:
            raise HTTPException(status_code=404, detail="Soldier not found")

        # Cleanup junctions & vacations, then soldier row
        s.execute(delete(SoldierRole).where(SoldierRole.soldier_id == soldier_id))
        s.execute(delete(Vacation).where(Vacation.soldier_id == soldier_id))
        s.execute(delete(Soldier).where(Soldier.id == soldier_id))
        s.commit()
        return None
