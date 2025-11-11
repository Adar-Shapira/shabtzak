from __future__ import annotations

from datetime import datetime, timezone, date, timedelta, time as time_cls
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from sqlalchemy import and_, delete, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.db import get_db
from app.models.assignment import Assignment
from app.models.department import Department
from app.models.mission import Mission
from app.models.mission_requirement import MissionRequirement
from app.models.mission_slot import MissionSlot
from app.models.role import Role
from app.models.soldier import Soldier
from app.models.soldier_role import SoldierRole
from app.models.vacation import Vacation


router = APIRouter(prefix="/data", tags=["data-transfer"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_day(day: str) -> date:
    try:
        return date.fromisoformat(day)
    except ValueError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=400, detail="day must be YYYY-MM-DD") from exc


def _day_bounds(day: str) -> tuple[datetime, datetime]:
    d = _parse_day(day)
    start = datetime(d.year, d.month, d.day)
    end = start + timedelta(days=1)
    return start, end


# ---------------------------------------------------------------------------
# Soldiers / Departments / Roles
# ---------------------------------------------------------------------------


class DepartmentRecord(BaseModel):
    name: str


class RoleRecord(BaseModel):
    name: str


class SoldierRecord(BaseModel):
    name: str
    department: Optional[str] = None
    restrictions: Optional[str] = ""
    missions_history: Optional[str] = ""
    roles: List[str] = Field(default_factory=list)


class SoldiersPackage(BaseModel):
    kind: str = Field(default="soldiers")
    version: str = Field(default="1.0")
    exported_at: Optional[datetime] = None
    departments: List[DepartmentRecord] = Field(default_factory=list)
    roles: List[RoleRecord] = Field(default_factory=list)
    soldiers: List[SoldierRecord] = Field(default_factory=list)


class SoldiersImportResult(BaseModel):
    created_departments: int = 0
    created_roles: int = 0
    created_soldiers: int = 0
    updated_soldiers: int = 0
    role_links_updated: int = 0


@router.get("/export/soldiers", response_model=SoldiersPackage)
def export_soldiers(db: Session = Depends(get_db)) -> SoldiersPackage:
    departments = db.scalars(select(Department).order_by(Department.id)).all()
    roles = db.scalars(select(Role).order_by(Role.id)).all()
    soldiers = (
        db.execute(
            select(Soldier)
            .options(
                selectinload(Soldier.department),
                selectinload(Soldier.roles),
            )
            .order_by(Soldier.id)
        )
        .scalars()
        .all()
    )

    return SoldiersPackage(
        exported_at=_now(),
        departments=[DepartmentRecord(name=d.name) for d in departments],
        roles=[RoleRecord(name=r.name) for r in roles],
        soldiers=[
            SoldierRecord(
                name=s.name,
                department=s.department.name if s.department else None,
                restrictions=s.restrictions or "",
                missions_history=s.missions_history or "",
                roles=sorted({r.name for r in (s.roles or [])}),
            )
            for s in soldiers
        ],
    )


@router.post("/import/soldiers", response_model=SoldiersImportResult)
def import_soldiers(payload: SoldiersPackage, db: Session = Depends(get_db)) -> SoldiersImportResult:
    created_departments = 0
    created_roles = 0
    created_soldiers = 0
    updated_soldiers = 0
    role_links_updated = 0

    # Normalise existing departments / roles caches
    departments_by_name: Dict[str, Department] = {
        d.name: d for d in db.scalars(select(Department)).all()
    }
    roles_by_name: Dict[str, Role] = {r.name: r for r in db.scalars(select(Role)).all()}

    # Ensure departments from package exist
    for dept in payload.departments:
        name = (dept.name or "").strip()
        if not name:
            continue
        if name not in departments_by_name:
            new_dept = Department(name=name)
            db.add(new_dept)
            db.flush()
            departments_by_name[name] = new_dept
            created_departments += 1

    # Ensure roles from package exist
    for role in payload.roles:
        name = (role.name or "").strip()
        if not name:
            continue
        if name not in roles_by_name:
            new_role = Role(name=name)
            db.add(new_role)
            db.flush()
            roles_by_name[name] = new_role
            created_roles += 1

    for row in payload.soldiers:
        soldier_name = (row.name or "").strip()
        if not soldier_name:
            continue

        dept_id = None
        if row.department:
            dept = departments_by_name.get(row.department)
            if not dept:
                dept = Department(name=row.department.strip())
                db.add(dept)
                db.flush()
                departments_by_name[row.department] = dept
                created_departments += 1
            dept_id = dept.id

        soldier = db.scalars(select(Soldier).where(Soldier.name == soldier_name)).first()
        if soldier:
            soldier.department_id = dept_id
            soldier.restrictions = (row.restrictions or "").strip()
            soldier.missions_history = (row.missions_history or "").strip()
            updated_soldiers += 1
        else:
            soldier = Soldier(
                name=soldier_name,
                department_id=dept_id,
                restrictions=(row.restrictions or "").strip(),
                missions_history=(row.missions_history or "").strip(),
            )
            db.add(soldier)
            db.flush()
            created_soldiers += 1

        # Replace role links
        db.execute(delete(SoldierRole).where(SoldierRole.soldier_id == soldier.id))

        seen_role_names = set()
        for role_name in row.roles or []:
            role_key = (role_name or "").strip()
            if not role_key or role_key in seen_role_names:
                continue
            seen_role_names.add(role_key)
            role_obj = roles_by_name.get(role_key)
            if not role_obj:
                role_obj = Role(name=role_key)
                db.add(role_obj)
                db.flush()
                roles_by_name[role_key] = role_obj
                created_roles += 1
            db.add(SoldierRole(soldier_id=soldier.id, role_id=role_obj.id))
            role_links_updated += 1

    db.commit()

    return SoldiersImportResult(
        created_departments=created_departments,
        created_roles=created_roles,
        created_soldiers=created_soldiers,
        updated_soldiers=updated_soldiers,
        role_links_updated=role_links_updated,
    )


# ---------------------------------------------------------------------------
# Missions / Requirements / Slots
# ---------------------------------------------------------------------------


class MissionSlotRecord(BaseModel):
    start_time: str
    end_time: str


class MissionRequirementRecord(BaseModel):
    role: str
    count: int = 1


class MissionRecord(BaseModel):
    name: str
    total_needed: Optional[int] = None
    order: Optional[int] = None
    slots: List[MissionSlotRecord] = Field(default_factory=list)
    requirements: List[MissionRequirementRecord] = Field(default_factory=list)


class MissionsPackage(BaseModel):
    kind: str = Field(default="missions")
    version: str = Field(default="1.0")
    exported_at: Optional[datetime] = None
    missions: List[MissionRecord] = Field(default_factory=list)


class MissionsImportResult(BaseModel):
    created_missions: int = 0
    updated_missions: int = 0
    created_roles: int = 0
    slots_replaced: int = 0
    requirements_replaced: int = 0


@router.get("/export/missions", response_model=MissionsPackage)
def export_missions(db: Session = Depends(get_db)) -> MissionsPackage:
    missions = (
        db.execute(
            select(Mission)
            .options(
                selectinload(Mission.slots),
                selectinload(Mission.requirements).selectinload(MissionRequirement.role),
            )
            .order_by(Mission.order, Mission.id)
        )
        .scalars()
        .all()
    )

    payload = []
    for mission in missions:
        payload.append(
            MissionRecord(
                name=mission.name,
                total_needed=mission.total_needed,
                order=mission.order,
                slots=[
                    MissionSlotRecord(
                        start_time=s.start_time.isoformat(timespec="seconds"),
                        end_time=s.end_time.isoformat(timespec="seconds"),
                    )
                    for s in sorted(mission.slots, key=lambda sl: sl.start_time)
                ],
                requirements=[
                    MissionRequirementRecord(
                        role=req.role.name if req.role else "",
                        count=req.count or 0,
                    )
                    for req in sorted(
                        mission.requirements,
                        key=lambda r: (r.role.name if r.role else "", r.id),
                    )
                ],
            )
        )

    return MissionsPackage(exported_at=_now(), missions=payload)


@router.post("/import/missions", response_model=MissionsImportResult)
def import_missions(payload: MissionsPackage, db: Session = Depends(get_db)) -> MissionsImportResult:
    created_missions = 0
    updated_missions = 0
    created_roles = 0
    slots_replaced = 0
    requirements_replaced = 0

    roles_by_name: Dict[str, Role] = {r.name: r for r in db.scalars(select(Role)).all()}

    for mission_row in payload.missions:
        name = (mission_row.name or "").strip()
        if not name:
            continue

        mission = db.scalars(select(Mission).where(Mission.name == name)).first()
        if mission:
            mission.total_needed = mission_row.total_needed
            if mission_row.order is not None:
                mission.order = mission_row.order
            updated_missions += 1
        else:
            max_order = db.scalar(select(func.max(Mission.order))) or 0
            mission = Mission(
                name=name,
                total_needed=mission_row.total_needed,
                order=mission_row.order if mission_row.order is not None else max_order + 1,
            )
            db.add(mission)
            db.flush()
            created_missions += 1

        # Replace slots
        deleted_slots = db.execute(delete(MissionSlot).where(MissionSlot.mission_id == mission.id))
        slots_replaced += deleted_slots.rowcount or 0
        for slot in mission_row.slots:
            try:
                start = time_cls.fromisoformat(slot.start_time)
                end = time_cls.fromisoformat(slot.end_time)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"Invalid time format in mission '{name}'") from exc
            db.add(
                MissionSlot(
                    mission_id=mission.id,
                    start_time=start,
                    end_time=end,
                )
            )

        # Replace requirements
        deleted_requirements = db.execute(
            delete(MissionRequirement).where(MissionRequirement.mission_id == mission.id)
        )
        requirements_replaced += deleted_requirements.rowcount or 0
        for req in mission_row.requirements:
            role_name = (req.role or "").strip()
            if not role_name:
                continue
            role = roles_by_name.get(role_name)
            if not role:
                role = Role(name=role_name)
                db.add(role)
                db.flush()
                roles_by_name[role_name] = role
                created_roles += 1
            db.add(
                MissionRequirement(
                    mission_id=mission.id,
                    role_id=role.id,
                    count=req.count or 0,
                )
            )

    db.commit()

    return MissionsImportResult(
        created_missions=created_missions,
        updated_missions=updated_missions,
        created_roles=created_roles,
        slots_replaced=slots_replaced,
        requirements_replaced=requirements_replaced,
    )


# ---------------------------------------------------------------------------
# Planner Assignments
# ---------------------------------------------------------------------------


class PlannerAssignmentRecord(BaseModel):
    mission: Optional[str]
    role: Optional[str] = None
    soldier: Optional[str] = None
    start_at: str
    end_at: str


class PlannerPackage(BaseModel):
    kind: str = Field(default="planner")
    version: str = Field(default="1.0")
    exported_at: Optional[datetime] = None
    day: str
    assignments: List[PlannerAssignmentRecord] = Field(default_factory=list)


class PlannerImportRequest(PlannerPackage):
    replace: bool = True


class PlannerImportResult(BaseModel):
    day: str
    deleted_assignments: int = 0
    created_assignments: int = 0
    created_missions: int = 0
    created_roles: int = 0
    created_soldiers: int = 0


class PlannerDayRecord(BaseModel):
    day: str
    assignments: List[PlannerAssignmentRecord] = Field(default_factory=list)


class PlannerAllPackage(BaseModel):
    kind: str = Field(default="planner-all")
    version: str = Field(default="1.0")
    exported_at: Optional[datetime] = None
    plans: List[PlannerDayRecord] = Field(default_factory=list)


class PlannerAllImportRequest(PlannerAllPackage):
    replace: bool = True


class PlannerAllImportResult(BaseModel):
    total_days: int = 0
    deleted_assignments: int = 0
    created_assignments: int = 0
    created_missions: int = 0
    created_roles: int = 0
    created_soldiers: int = 0


@router.get("/export/planner", response_model=PlannerPackage)
def export_planner(day: str = Query(..., description="YYYY-MM-DD"), db: Session = Depends(get_db)) -> PlannerPackage:
    start, end = _day_bounds(day)

    assignments = (
        db.execute(
            select(Assignment)
            .options(
                joinedload(Assignment.mission),
                joinedload(Assignment.role),
                joinedload(Assignment.soldier),
            )
            .where(and_(Assignment.start_at >= start, Assignment.start_at < end))
            .order_by(Assignment.start_at, Assignment.id)
        )
        .scalars()
        .all()
    )

    return PlannerPackage(
        exported_at=_now(),
        day=day,
        assignments=[
            PlannerAssignmentRecord(
                mission=a.mission.name if a.mission else None,
                role=a.role.name if a.role else None,
                soldier=a.soldier.name if a.soldier else None,
                start_at=a.start_at.isoformat(timespec="seconds"),
                end_at=a.end_at.isoformat(timespec="seconds"),
            )
            for a in assignments
        ],
    )


@router.post("/import/planner", response_model=PlannerImportResult)
def import_planner(payload: PlannerImportRequest, db: Session = Depends(get_db)) -> PlannerImportResult:
    if not payload.day:
        raise HTTPException(status_code=400, detail="day is required")

    start, end = _day_bounds(payload.day)

    deleted_count = 0
    if payload.replace:
        deleted = db.execute(
            delete(Assignment).where(and_(Assignment.start_at >= start, Assignment.start_at < end))
        )
        deleted_count = deleted.rowcount or 0

    roles_by_name: Dict[str, Role] = {r.name: r for r in db.scalars(select(Role)).all()}
    missions_by_name: Dict[str, Mission] = {m.name: m for m in db.scalars(select(Mission)).all()}
    soldiers_by_name: Dict[str, Soldier] = {s.name: s for s in db.scalars(select(Soldier)).all()}

    created_assignments = 0
    created_missions = 0
    created_roles = 0
    created_soldiers = 0

    for item in payload.assignments:
        mission_name = (item.mission or "").strip()
        if not mission_name:
            raise HTTPException(status_code=400, detail="Each assignment must include a mission name")

        mission = missions_by_name.get(mission_name)
        if not mission:
            max_order = db.scalar(select(func.max(Mission.order))) or 0
            mission = Mission(name=mission_name, total_needed=None, order=max_order + 1)
            db.add(mission)
            db.flush()
            missions_by_name[mission_name] = mission
            created_missions += 1

        role_id = None
        role_name = (item.role or "").strip()
        if role_name:
            role = roles_by_name.get(role_name)
            if not role:
                role = Role(name=role_name)
                db.add(role)
                db.flush()
                roles_by_name[role_name] = role
                created_roles += 1
            role_id = role.id

        soldier_id = None
        soldier_name = (item.soldier or "").strip()
        if soldier_name:
            soldier = soldiers_by_name.get(soldier_name)
            if not soldier:
                soldier = Soldier(
                    name=soldier_name,
                    department_id=None,
                    restrictions="",
                    missions_history="",
                )
                db.add(soldier)
                db.flush()
                soldiers_by_name[soldier_name] = soldier
                created_soldiers += 1
            soldier_id = soldier.id

        try:
            start_at = datetime.fromisoformat(item.start_at)
            end_at = datetime.fromisoformat(item.end_at)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid datetime format in assignment for mission '{mission_name}'",
            ) from exc

        db.add(
            Assignment(
                mission_id=mission.id,
                role_id=role_id,
                soldier_id=soldier_id,
                start_at=start_at,
                end_at=end_at,
            )
        )
        created_assignments += 1

    db.commit()

    return PlannerImportResult(
        day=payload.day,
        deleted_assignments=deleted_count,
        created_assignments=created_assignments,
        created_missions=created_missions,
        created_roles=created_roles,
        created_soldiers=created_soldiers,
    )


@router.get("/export/planner/all", response_model=PlannerAllPackage)
def export_planner_all(db: Session = Depends(get_db)) -> PlannerAllPackage:
    assignments = (
        db.execute(
            select(Assignment)
            .options(
                joinedload(Assignment.mission),
                joinedload(Assignment.role),
                joinedload(Assignment.soldier),
            )
            .order_by(Assignment.start_at, Assignment.id)
        )
        .scalars()
        .all()
    )

    plans: Dict[str, List[PlannerAssignmentRecord]] = {}
    for a in assignments:
        start_iso = a.start_at.isoformat(timespec="seconds")
        end_iso = a.end_at.isoformat(timespec="seconds")
        day_key = start_iso[:10]
        plans.setdefault(day_key, []).append(
            PlannerAssignmentRecord(
                mission=a.mission.name if a.mission else None,
                role=a.role.name if a.role else None,
                soldier=a.soldier.name if a.soldier else None,
                start_at=start_iso,
                end_at=end_iso,
            )
        )

    plan_records = [
        PlannerDayRecord(day=day, assignments=entries)
        for day, entries in sorted(plans.items(), key=lambda item: item[0])
    ]

    return PlannerAllPackage(
        exported_at=_now(),
        plans=plan_records,
    )


@router.post("/import/planner/all", response_model=PlannerAllImportResult)
def import_planner_all(payload: PlannerAllImportRequest, db: Session = Depends(get_db)) -> PlannerAllImportResult:
    if not payload.plans:
        return PlannerAllImportResult()

    deleted_assignments = 0
    created_assignments = 0
    created_missions = 0
    created_roles = 0
    created_soldiers = 0

    roles_by_name: Dict[str, Role] = {r.name: r for r in db.scalars(select(Role)).all()}
    missions_by_name: Dict[str, Mission] = {m.name: m for m in db.scalars(select(Mission)).all()}
    soldiers_by_name: Dict[str, Soldier] = {s.name: s for s in db.scalars(select(Soldier)).all()}

    if payload.replace:
        deleted = db.execute(delete(Assignment))
        deleted_assignments = deleted.rowcount or 0

    for plan in payload.plans:
        day = (plan.day or "").strip()
        if not day:
            continue

        if not payload.replace:
            start, end = _day_bounds(day)
            deleted = db.execute(
                delete(Assignment).where(and_(Assignment.start_at >= start, Assignment.start_at < end))
            )
            deleted_assignments += deleted.rowcount or 0

        for item in plan.assignments:
            mission_name = (item.mission or "").strip()
            if not mission_name:
                raise HTTPException(status_code=400, detail="Each assignment must include a mission name")

            mission = missions_by_name.get(mission_name)
            if not mission:
                max_order = db.scalar(select(func.max(Mission.order))) or 0
                mission = Mission(name=mission_name, total_needed=None, order=max_order + 1)
                db.add(mission)
                db.flush()
                missions_by_name[mission_name] = mission
                created_missions += 1

            role_id = None
            role_name = (item.role or "").strip()
            if role_name:
                role = roles_by_name.get(role_name)
                if not role:
                    role = Role(name=role_name)
                    db.add(role)
                    db.flush()
                    roles_by_name[role_name] = role
                    created_roles += 1
                role_id = role.id

            soldier_id = None
            soldier_name = (item.soldier or "").strip()
            if soldier_name:
                soldier = soldiers_by_name.get(soldier_name)
                if not soldier:
                    soldier = Soldier(
                        name=soldier_name,
                        department_id=None,
                        restrictions="",
                        missions_history="",
                    )
                    db.add(soldier)
                    db.flush()
                    soldiers_by_name[soldier_name] = soldier
                    created_soldiers += 1
                soldier_id = soldier.id

            try:
                start_at = datetime.fromisoformat(item.start_at)
                end_at = datetime.fromisoformat(item.end_at)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid datetime format in assignment for mission '{mission_name}'",
                ) from exc

            db.add(
                Assignment(
                    mission_id=mission.id,
                    role_id=role_id,
                    soldier_id=soldier_id,
                    start_at=start_at,
                    end_at=end_at,
                )
            )
            created_assignments += 1

    db.commit()

    return PlannerAllImportResult(
        total_days=len(payload.plans),
        deleted_assignments=deleted_assignments,
        created_assignments=created_assignments,
        created_missions=created_missions,
        created_roles=created_roles,
        created_soldiers=created_soldiers,
    )


# ---------------------------------------------------------------------------
# Manpower / Vacations
# ---------------------------------------------------------------------------


class VacationRecord(BaseModel):
    soldier: str
    start_date: date
    end_date: date


class ManpowerPackage(BaseModel):
    kind: str = Field(default="manpower")
    version: str = Field(default="1.0")
    exported_at: Optional[datetime] = None
    vacations: List[VacationRecord] = Field(default_factory=list)


class ManpowerImportRequest(ManpowerPackage):
    replace: bool = False


class ManpowerImportResult(BaseModel):
    created_soldiers: int = 0
    created_vacations: int = 0
    skipped_vacations: int = 0
    cleared_vacations: int = 0


@router.get("/export/manpower", response_model=ManpowerPackage)
def export_manpower(db: Session = Depends(get_db)) -> ManpowerPackage:
    vacations = (
        db.execute(
            select(Vacation)
            .options(joinedload(Vacation.soldier))
            .order_by(Vacation.start_date, Vacation.id)
        )
        .scalars()
        .all()
    )

    payload = []
    for vac in vacations:
        if not vac.soldier:
            continue
        payload.append(
            VacationRecord(
                soldier=vac.soldier.name,
                start_date=vac.start_date,
                end_date=vac.end_date,
            )
        )

    return ManpowerPackage(exported_at=_now(), vacations=payload)


@router.post("/import/manpower", response_model=ManpowerImportResult)
def import_manpower(payload: ManpowerImportRequest, db: Session = Depends(get_db)) -> ManpowerImportResult:
    created_soldiers = 0
    created_vacations = 0
    skipped_vacations = 0
    cleared_vacations = 0

    soldiers_by_name: Dict[str, Soldier] = {s.name: s for s in db.scalars(select(Soldier)).all()}

    if payload.replace:
        cleared = db.execute(delete(Vacation))
        cleared_vacations = cleared.rowcount or 0

    for row in payload.vacations:
        soldier_name = (row.soldier or "").strip()
        if not soldier_name:
            skipped_vacations += 1
            continue

        soldier = soldiers_by_name.get(soldier_name)
        if not soldier:
            soldier = Soldier(name=soldier_name, restrictions="", missions_history="")
            db.add(soldier)
            db.flush()
            soldiers_by_name[soldier_name] = soldier
            created_soldiers += 1

        if not payload.replace:
            # Remove overlaps with the incoming window to keep data clean
            db.execute(
                delete(Vacation).where(
                    and_(
                        Vacation.soldier_id == soldier.id,
                        Vacation.start_date <= row.end_date,
                        Vacation.end_date >= row.start_date,
                    )
                )
            )

        existing = db.scalars(
            select(Vacation).where(
                Vacation.soldier_id == soldier.id,
                Vacation.start_date == row.start_date,
                Vacation.end_date == row.end_date,
            )
        ).first()
        if existing:
            skipped_vacations += 1
            continue

        db.add(
            Vacation(
                soldier_id=soldier.id,
                start_date=row.start_date,
                end_date=row.end_date,
            )
        )
        created_vacations += 1

    db.commit()

    return ManpowerImportResult(
        created_soldiers=created_soldiers,
        created_vacations=created_vacations,
        skipped_vacations=skipped_vacations,
        cleared_vacations=cleared_vacations,
    )


