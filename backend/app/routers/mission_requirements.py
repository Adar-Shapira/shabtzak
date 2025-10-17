# backend\app\routers\mission_requirements.py
from __future__ import annotations

from typing import List

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select, insert
from sqlalchemy.orm import joinedload

from app.db import SessionLocal
from app.models.mission import Mission
from app.models.mission_requirement import MissionRequirement
from app.models.role import Role

router = APIRouter(tags=["missions"])

class RequirementIn(BaseModel):
    role_id: int
    count: int

    @field_validator("count")
    @classmethod
    def _v_count(cls, v: int) -> int:
        if v < 0:
            raise ValueError("count must be >= 0")
        return v

class RequirementOut(BaseModel):
    id: int
    role_id: int
    role_name: str
    count: int

@router.get("/missions/{mission_id}/requirements", response_model=List[RequirementOut])
def get_requirements(mission_id: int = Path(ge=1)):
    with SessionLocal() as s:
        mission = s.get(Mission, mission_id)
        if not mission:
            raise HTTPException(404, "Mission not found")

        q = (
            select(MissionRequirement, Role)
            .join(Role, Role.id == MissionRequirement.role_id)
            .where(MissionRequirement.mission_id == mission_id)
            .order_by(Role.name.asc(), MissionRequirement.id.asc())
        )
        rows = s.execute(q).all()
        return [
            RequirementOut(
                id=req.id,
                role_id=role.id,
                role_name=role.name or f"Role {role.id}",
                count=req.count or 0,
            )
            for (req, role) in rows
        ]

@router.put("/missions/{mission_id}/requirements", response_model=List[RequirementOut])
def put_requirements(mission_id: int, payload: List[RequirementIn]):
    with SessionLocal() as s:
        mission = s.get(Mission, mission_id)
        if not mission:
            raise HTTPException(404, "Mission not found")

        # validate roles exist
        role_ids = {item.role_id for item in payload}
        if role_ids:
            existing_roles = {r.id for r in s.execute(select(Role).where(Role.id.in_(role_ids))).scalars().all()}
            missing = role_ids - existing_roles
            if missing:
                raise HTTPException(400, f"Unknown role_id(s): {sorted(missing)}")

        # replace-all semantics
        s.execute(delete(MissionRequirement).where(MissionRequirement.mission_id == mission_id))
        for item in payload:
            if item.count > 0:
                s.execute(
                    insert(MissionRequirement).values(
                        mission_id=mission_id,
                        role_id=item.role_id,
                        count=item.count,
                    )
                )
        s.commit()

        # return fresh list
        q = (
            select(MissionRequirement, Role)
            .join(Role, Role.id == MissionRequirement.role_id)
            .where(MissionRequirement.mission_id == mission_id)
            .order_by(Role.name.asc(), MissionRequirement.id.asc())
        )
        rows = s.execute(q).all()
        return [
            RequirementOut(
                id=req.id,
                role_id=role.id,
                role_name=role.name or f"Role {role.id}",
                count=req.count or 0,
            )
            for (req, role) in rows
        ]
