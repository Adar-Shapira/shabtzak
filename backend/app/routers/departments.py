# backend/app/routers/departments.py
from fastapi import APIRouter, HTTPException
from sqlalchemy import select, insert, update, delete, func
from app.db import SessionLocal
from app.models.department import Department
from app.models.soldier import Soldier
from pydantic import BaseModel

router = APIRouter(prefix="/departments", tags=["departments"])

class DepartmentIn(BaseModel):
    name: str

@router.get("", response_model=list[dict])
def list_departments():
    with SessionLocal() as s:
        rows = s.execute(select(Department.id, Department.name).order_by(Department.id)).all()
        return [{"id": r.id, "name": r.name} for r in rows]

@router.post("", status_code=201)
def create_department(payload: DepartmentIn):
    with SessionLocal() as s:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Name required")
        res = s.execute(insert(Department).values(name=name).returning(Department.id))
        s.commit()
        return {"id": res.scalar_one(), "name": name}

@router.patch("/{dept_id}")
def update_department(dept_id: int, payload: DepartmentIn):
    with SessionLocal() as s:
        res = s.execute(update(Department).where(Department.id == dept_id)
                        .values(name=payload.name.strip()))
        if res.rowcount == 0:
            raise HTTPException(404, "Department not found")
        s.commit()
        return {"id": dept_id, "name": payload.name.strip()}

@router.delete("/{dept_id}", status_code=204)
def delete_department(dept_id: int):
    with SessionLocal() as s:
        used = s.execute(
            select(func.count()).select_from(Soldier).where(Soldier.department_id == dept_id)
        ).scalar_one()
        if used:
            raise HTTPException(400, "Department is used by soldiers")
        res = s.execute(delete(Department).where(Department.id == dept_id))
        if res.rowcount == 0:
            raise HTTPException(404, "Department not found")
        s.commit()
        return None
