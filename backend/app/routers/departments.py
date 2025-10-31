from fastapi import APIRouter, HTTPException
from sqlalchemy import select, insert, update, delete, func
from sqlalchemy.exc import IntegrityError
import logging

from app.db import SessionLocal
from app.models.department import Department
from app.models.soldier import Soldier
from pydantic import BaseModel

router = APIRouter(prefix="/departments", tags=["departments"])
logger = logging.getLogger(__name__)


class DepartmentIn(BaseModel):
    name: str


@router.get("", response_model=list[dict])
def list_departments():
    with SessionLocal() as s:
        rows = s.execute(select(Department.id, Department.name).order_by(Department.id)).all()
        return [{"id": r.id, "name": r.name} for r in rows]


@router.post("", status_code=201)
def create_department(payload: DepartmentIn):
    try:
        # Safe logging that handles encoding issues
        try:
            logger.info(f"[departments] Creating department with name: '{payload.name}'")
        except Exception:
            pass  # Skip logging if encoding fails
            
        with SessionLocal() as s:
            name = payload.name.strip()
            if not name:
                try:
                    logger.warning("[departments] Error: Empty name")
                except Exception:
                    pass
                raise HTTPException(status_code=400, detail="Name required")
            try:
                # For SQLite, we need to fetch the result before committing
                res = s.execute(insert(Department).values(name=name).returning(Department.id))
                dept_id = res.scalar_one()  # Fetch BEFORE commit
                s.commit()
                try:
                    logger.info(f"[departments] Successfully created department with id: {dept_id}")
                except Exception:
                    pass
                return {"id": dept_id, "name": name}
            except IntegrityError as e:
                s.rollback()
                try:
                    logger.error(f"[departments] IntegrityError: {e}")
                except Exception:
                    pass
                raise HTTPException(status_code=409, detail="Department name already exists")
            except Exception as e:
                s.rollback()
                try:
                    logger.error(f"[departments] Unexpected error: {e}")
                    import traceback
                    logger.error(f"[departments] Traceback: {traceback.format_exc()}")
                except Exception:
                    pass
                raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        try:
            logger.error(f"[departments] Outer exception: {e}")
            import traceback
            logger.error(f"[departments] Traceback: {traceback.format_exc()}")
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.patch("/{dept_id}")
def update_department(dept_id: int, payload: DepartmentIn):
    with SessionLocal() as s:
        try:
            res = s.execute(
                update(Department)
                .where(Department.id == dept_id)
                .values(name=payload.name.strip())
            )
            if res.rowcount == 0:
                raise HTTPException(status_code=404, detail="Department not found")
            s.commit()
            return {"id": dept_id, "name": payload.name.strip()}
        except IntegrityError:
            s.rollback()
            raise HTTPException(status_code=409, detail="Department name already exists")


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
