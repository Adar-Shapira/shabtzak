from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.exc import IntegrityError
from app.db import SessionLocal
from app.models.department import Department
from app.models.soldier import Soldier  # to block delete if used

router = APIRouter(prefix="/departments", tags=["departments"])

class DepartmentIn(BaseModel):
    name: str

@router.get("")
def list_departments():
    with SessionLocal() as s:
        rows = s.execute(select(Department).order_by(Department.id)).scalars().all()
        return [{"id": d.id, "name": d.name} for d in rows]

@router.post("", status_code=201)
def create_department(payload: DepartmentIn):
    with SessionLocal() as s:
        try:
            new_id = s.execute(
                insert(Department).values(name=payload.name).returning(Department.id)
            ).scalar_one()
            s.commit()
            return {"id": new_id, **payload.model_dump()}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Department name already exists")

@router.patch("/{dept_id}")
def update_department(dept_id: int, payload: DepartmentIn):
    with SessionLocal() as s:
        res = s.execute(update(Department).where(Department.id == dept_id)
                        .values(name=payload.name.strip()))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Department not found")
        s.commit()
        return {"id": dept_id, "name": payload.name.strip()}

@router.delete("/{dept_id}", status_code=204)
def delete_department(dept_id: int):
    with SessionLocal() as s:
        used = s.execute(
            select(func.count()).select_from(Soldier).where(Soldier.department_id == dept_id)
        ).scalar_one()
        if used:
            raise HTTPException(status_code=400, detail="Department is used by soldiers")
        res = s.execute(delete(Department).where(Department.id == dept_id))
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Department not found")
        s.commit()
        return None

