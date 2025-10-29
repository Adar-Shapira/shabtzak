# backend/app/routers/saved_plans.py
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.saved_plan import SavedPlan
from app.models.assignment import Assignment
from app.models.mission_slot import MissionSlot
from app.models.mission_requirement import MissionRequirement
from app.models.mission import Mission

router = APIRouter(prefix="/saved-plans", tags=["saved-plans"])


class SavedPlanData(BaseModel):
    assignments: List[dict]  # FlatRosterItem format
    excluded_slots: List[str]
    locked_assignments: List[int]


class SavePlanRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    day: str = Field(..., description="YYYY-MM-DD")
    plan_data: SavedPlanData


class SavedPlanResponse(BaseModel):
    id: int
    name: str
    day: str
    created_at: datetime
    updated_at: datetime


class SavedPlanDetailResponse(SavedPlanResponse):
    plan_data: SavedPlanData


@router.post("", response_model=SavedPlanResponse, status_code=201)
def save_plan(req: SavePlanRequest, db: Session = Depends(get_db)):
    """Save a plan with a given name."""
    saved_plan = SavedPlan(
        name=req.name,
        day=req.day,
        plan_data=req.plan_data.model_dump(),
    )
    db.add(saved_plan)
    db.commit()
    db.refresh(saved_plan)
    return SavedPlanResponse(
        id=saved_plan.id,
        name=saved_plan.name,
        day=saved_plan.day,
        created_at=saved_plan.created_at,
        updated_at=saved_plan.updated_at,
    )


@router.get("", response_model=List[SavedPlanResponse])
def list_plans(day: Optional[str] = None, db: Session = Depends(get_db)):
    """List all saved plans. Optionally filter by day (YYYY-MM-DD)."""
    query = select(SavedPlan)
    if day:
        query = query.where(SavedPlan.day == day)
    plans = db.execute(query.order_by(SavedPlan.created_at.desc())).scalars().all()
    return [
        SavedPlanResponse(
            id=p.id,
            name=p.name,
            day=p.day,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in plans
    ]


@router.get("/{plan_id}", response_model=SavedPlanDetailResponse)
def get_plan(plan_id: int, db: Session = Depends(get_db)):
    """Get a specific plan by ID (for viewing)."""
    plan = db.get(SavedPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    return SavedPlanDetailResponse(
        id=plan.id,
        name=plan.name,
        day=plan.day,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
        plan_data=SavedPlanData(**plan.plan_data),
    )


@router.post("/{plan_id}/load")
def load_plan(plan_id: int, day: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Load a saved plan into the current planner.
    Creates assignments for the specified day (or the plan's original day).
    """
    plan = db.get(SavedPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    target_day = day or plan.day
    
    plan_data = SavedPlanData(**plan.plan_data)
    
    # First, clear existing assignments for the target day
    # We'll preserve locked assignments if they exist
    from sqlalchemy import delete, and_
    from datetime import date, datetime, timedelta
    
    target_date = date.fromisoformat(target_day)
    day_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0)
    day_end = day_start + timedelta(days=1)
    
    # Delete assignments for the target day (excluding locked ones if provided)
    # For now, we'll delete all assignments for the day
    db.execute(
        delete(Assignment).where(
            and_(
                Assignment.start_at >= day_start,
                Assignment.start_at < day_end
            )
        )
    )
    
    # Now create the assignments from the saved plan
    created_count = 0
    for assignment_data in plan_data.assignments:
        # assignment_data should have: mission_id, role_id, soldier_id, start_at, end_at
        # Parse the original datetime, then adjust to target_day while keeping the time
        original_start = datetime.fromisoformat(assignment_data["start_at"].replace("Z", ""))
        original_end = datetime.fromisoformat(assignment_data["end_at"].replace("Z", ""))
        
        # Calculate the day offset for end (in case of overnight slots)
        # If end is on a different day than start, preserve that offset
        original_start_date = original_start.date()
        original_end_date = original_end.date()
        day_offset = (original_end_date - original_start_date).days
        
        # Adjust the date to target_day while keeping the time
        new_start = datetime(
            target_date.year, target_date.month, target_date.day,
            original_start.hour, original_start.minute, original_start.second
        )
        new_end = datetime(
            target_date.year, target_date.month, target_date.day,
            original_end.hour, original_end.minute, original_end.second
        ) + timedelta(days=day_offset)
        
        assignment = Assignment(
            mission_id=assignment_data["mission"]["id"],
            role_id=assignment_data.get("role_id"),
            soldier_id=assignment_data.get("soldier_id"),
            start_at=new_start,
            end_at=new_end,
        )
        db.add(assignment)
        created_count += 1
    
    db.commit()
    
    return {
        "message": "Plan loaded successfully",
        "day": target_day,
        "assignments_created": created_count,
    }


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    """Delete a saved plan."""
    plan = db.get(SavedPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    db.delete(plan)
    db.commit()
    return None

