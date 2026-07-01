"""物品借用系統 API。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any, require_permission
from api.services.permission import get_user_org_ids_with_permission
from api.models.loan import (
    LoanItemCategory,
    LoanRecord,
    LoanRecordStatus,
    LoanUnit,
    LoanUnitStatus,
)
from api.models.user import User

router = APIRouter(prefix="/loans", tags=["物品借用"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.LOAN_MANAGE))]
CheckoutUser = Annotated[
    User,
    Depends(require_any(PermissionCode.LOAN_MANAGE, PermissionCode.LOAN_CHECKOUT)),
]


# ── Schemas ────────────────────────────────────────────────────────────────────


class LoanItemCreate(BaseModel):
    name: str
    description: str | None = None
    image_url: str | None = None
    org_id: uuid.UUID | None = None
    default_due_days: int = 7


class LoanItemUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    image_url: str | None = None
    default_due_days: int | None = None
    is_active: bool | None = None


class LoanUnitOut(BaseModel):
    id: uuid.UUID
    unit_code: str
    status: LoanUnitStatus
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LoanItemOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    description: str | None
    image_url: str | None
    is_active: bool
    default_due_days: int
    created_at: datetime
    available_count: int = 0
    total_count: int = 0

    model_config = {"from_attributes": True}


class LoanAvailableItem(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    image_url: str | None
    default_due_days: int
    available_count: int
    total_count: int

    model_config = {"from_attributes": True}


class LoanUnitCreate(BaseModel):
    unit_codes: list[str]

    @field_validator("unit_codes")
    @classmethod
    def validate_codes(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("至少需要一個個體編號")
        stripped = [c.strip() for c in v if c.strip()]
        if len(stripped) != len(set(stripped)):
            raise ValueError("編號不能重複")
        return stripped


class LoanUnitUpdate(BaseModel):
    status: LoanUnitStatus | None = None
    notes: str | None = None
    unit_code: str | None = None


class LoanCheckoutCreate(BaseModel):
    unit_id: uuid.UUID
    borrower_name: str
    borrower_student_id: str | None = None
    borrower_email: EmailStr | None = None
    borrower_contact: str | None = None
    due_at: datetime
    notes: str | None = None


class LoanRecordOut(BaseModel):
    id: uuid.UUID
    unit_id: uuid.UUID
    unit_code: str = ""
    item_name: str = ""
    borrower_name: str
    borrower_student_id: str | None
    borrower_email: str | None
    borrower_contact: str | None
    borrowed_at: datetime
    due_at: datetime
    returned_at: datetime | None
    status: LoanRecordStatus
    reminder_sent_count: int
    notes: str | None
    handled_by_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LoanRecordUpdate(BaseModel):
    due_at: datetime | None = None
    notes: str | None = None
    status: LoanRecordStatus | None = None


class LoanDashboard(BaseModel):
    active_count: int
    overdue_count: int
    returned_today: int
    total_items: int
    available_units: int


def _record_out(record: LoanRecord) -> LoanRecordOut:
    unit_code = record.unit.unit_code if record.unit else ""
    item_name = record.unit.item.name if record.unit and record.unit.item else ""
    handled_name = record.handled_by.email if record.handled_by else None
    return LoanRecordOut(
        id=record.id,
        unit_id=record.unit_id,
        unit_code=unit_code,
        item_name=item_name,
        borrower_name=record.borrower_name,
        borrower_student_id=record.borrower_student_id,
        borrower_email=record.borrower_email,
        borrower_contact=record.borrower_contact,
        borrowed_at=record.borrowed_at,
        due_at=record.due_at,
        returned_at=record.returned_at,
        status=record.status,
        reminder_sent_count=record.reminder_sent_count,
        notes=record.notes,
        handled_by_name=handled_name,
        created_at=record.created_at,
    )


async def _item_with_counts(db: AsyncSession, item: LoanItemCategory) -> LoanItemOut:
    total = await db.scalar(
        select(func.count()).where(LoanUnit.item_id == item.id)
    )
    available = await db.scalar(
        select(func.count()).where(
            LoanUnit.item_id == item.id,
            LoanUnit.status == LoanUnitStatus.AVAILABLE,
        )
    )
    return LoanItemOut(
        id=item.id,
        org_id=item.org_id,
        name=item.name,
        description=item.description,
        image_url=item.image_url,
        is_active=item.is_active,
        default_due_days=item.default_due_days,
        created_at=item.created_at,
        available_count=available or 0,
        total_count=total or 0,
    )


# ── 物品類型管理 ───────────────────────────────────────────────────────────────


@router.get("/items", response_model=list[LoanItemOut])
async def list_items(db: DbDep, _: CheckoutUser) -> list[LoanItemOut]:
    rows = (
        (await db.execute(select(LoanItemCategory).where(LoanItemCategory.is_active == True).order_by(LoanItemCategory.created_at)))  # noqa: E712
        .scalars()
        .all()
    )
    return [await _item_with_counts(db, r) for r in rows]


@router.post("/items", response_model=LoanItemOut, status_code=201)
async def create_item(body: LoanItemCreate, db: DbDep, current_user: ManagerUser) -> LoanItemOut:
    org_id = body.org_id
    if org_id is None:
        org_ids = await get_user_org_ids_with_permission(
            db, current_user.id, PermissionCode.LOAN_MANAGE
        )
        if not org_ids:
            raise HTTPException(status_code=403, detail="找不到有管理借用物品權限的組織")
        org_id = org_ids[0]

    item = LoanItemCategory(
        id=uuid.uuid4(),
        org_id=org_id,
        name=body.name,
        description=body.description,
        image_url=body.image_url,
        default_due_days=body.default_due_days,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return await _item_with_counts(db, item)


@router.patch("/items/{item_id}", response_model=LoanItemOut)
async def update_item(item_id: uuid.UUID, body: LoanItemUpdate, db: DbDep, _: ManagerUser) -> LoanItemOut:
    item = await db.get(LoanItemCategory, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="物品類型不存在")
    if body.name is not None:
        item.name = body.name
    if body.description is not None:
        item.description = body.description
    if body.image_url is not None:
        item.image_url = body.image_url
    if body.default_due_days is not None:
        item.default_due_days = body.default_due_days
    if body.is_active is not None:
        item.is_active = body.is_active
    await db.commit()
    await db.refresh(item)
    return await _item_with_counts(db, item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    item = await db.get(LoanItemCategory, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="物品類型不存在")
    item.is_active = False
    await db.commit()


@router.get("/items/{item_id}/units", response_model=list[LoanUnitOut])
async def list_units(item_id: uuid.UUID, db: DbDep, _: CheckoutUser) -> list[LoanUnitOut]:
    rows = (
        (
            await db.execute(
                select(LoanUnit)
                .where(LoanUnit.item_id == item_id)
                .order_by(LoanUnit.unit_code)
            )
        )
        .scalars()
        .all()
    )
    return [LoanUnitOut.model_validate(r) for r in rows]


@router.post("/items/{item_id}/units", response_model=list[LoanUnitOut], status_code=201)
async def add_units(item_id: uuid.UUID, body: LoanUnitCreate, db: DbDep, _: ManagerUser) -> list[LoanUnitOut]:
    item = await db.get(LoanItemCategory, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="物品類型不存在")

    existing = (
        (
            await db.execute(
                select(LoanUnit.unit_code).where(
                    LoanUnit.item_id == item_id,
                    LoanUnit.unit_code.in_(body.unit_codes),
                )
            )
        )
        .scalars()
        .all()
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"以下編號已存在：{', '.join(existing)}")

    units = [
        LoanUnit(id=uuid.uuid4(), item_id=item_id, unit_code=code)
        for code in body.unit_codes
    ]
    db.add_all(units)
    await db.commit()
    for u in units:
        await db.refresh(u)
    return [LoanUnitOut.model_validate(u) for u in units]


@router.patch("/units/{unit_id}", response_model=LoanUnitOut)
async def update_unit(unit_id: uuid.UUID, body: LoanUnitUpdate, db: DbDep, _: ManagerUser) -> LoanUnitOut:
    unit = await db.get(LoanUnit, unit_id)
    if not unit:
        raise HTTPException(status_code=404, detail="個體不存在")
    if body.status is not None:
        if body.status == LoanUnitStatus.AVAILABLE and unit.status == LoanUnitStatus.BORROWED:
            raise HTTPException(status_code=400, detail="借用中的個體無法直接設為可用，請先辦理歸還")
        unit.status = body.status
    if body.notes is not None:
        unit.notes = body.notes
    if body.unit_code is not None:
        unit.unit_code = body.unit_code
    await db.commit()
    await db.refresh(unit)
    return LoanUnitOut.model_validate(unit)


# ── 借還操作 ───────────────────────────────────────────────────────────────────


@router.get("/items/available", response_model=list[LoanAvailableItem])
async def available_items(db: DbDep, _: CheckoutUser) -> list[LoanAvailableItem]:
    rows = (
        (
            await db.execute(
                select(LoanItemCategory)
                .where(LoanItemCategory.is_active == True)  # noqa: E712
                .order_by(LoanItemCategory.name)
            )
        )
        .scalars()
        .all()
    )
    result = []
    for item in rows:
        total = await db.scalar(select(func.count()).where(LoanUnit.item_id == item.id)) or 0
        available = await db.scalar(
            select(func.count()).where(
                LoanUnit.item_id == item.id,
                LoanUnit.status == LoanUnitStatus.AVAILABLE,
            )
        ) or 0
        result.append(
            LoanAvailableItem(
                id=item.id,
                name=item.name,
                description=item.description,
                image_url=item.image_url,
                default_due_days=item.default_due_days,
                available_count=available,
                total_count=total,
            )
        )
    return result


@router.post("/checkout", response_model=LoanRecordOut, status_code=201)
async def checkout(body: LoanCheckoutCreate, db: DbDep, current_user: CheckoutUser) -> LoanRecordOut:
    unit = await db.get(
        LoanUnit, body.unit_id, options=[selectinload(LoanUnit.item)]
    )
    if not unit:
        raise HTTPException(status_code=404, detail="個體不存在")
    if unit.status != LoanUnitStatus.AVAILABLE:
        raise HTTPException(
            status_code=409,
            detail=f"此個體目前狀態為「{unit.status}」，無法借出",
        )

    now = now_local()
    record = LoanRecord(
        id=uuid.uuid4(),
        unit_id=unit.id,
        borrower_name=body.borrower_name,
        borrower_student_id=body.borrower_student_id,
        borrower_email=str(body.borrower_email) if body.borrower_email else None,
        borrower_contact=body.borrower_contact,
        borrowed_at=now,
        due_at=body.due_at,
        notes=body.notes,
        handled_by_id=current_user.id,
    )
    unit.status = LoanUnitStatus.BORROWED
    db.add(record)
    await db.commit()
    await db.refresh(record)

    record = await db.get(
        LoanRecord,
        record.id,
        options=[
            selectinload(LoanRecord.unit).selectinload(LoanUnit.item),
            selectinload(LoanRecord.handled_by),
        ],
    )
    return _record_out(record)


@router.post("/records/{record_id}/return", response_model=LoanRecordOut)
async def return_item(record_id: uuid.UUID, db: DbDep, current_user: CheckoutUser) -> LoanRecordOut:
    record = await db.get(
        LoanRecord,
        record_id,
        options=[
            selectinload(LoanRecord.unit).selectinload(LoanUnit.item),
            selectinload(LoanRecord.handled_by),
        ],
    )
    if not record:
        raise HTTPException(status_code=404, detail="借用紀錄不存在")
    if record.status == LoanRecordStatus.RETURNED:
        raise HTTPException(status_code=400, detail="此紀錄已完成歸還")

    record.returned_at = now_local()
    record.status = LoanRecordStatus.RETURNED
    record.return_handled_by_id = current_user.id

    unit = await db.get(LoanUnit, record.unit_id)
    if unit and unit.status == LoanUnitStatus.BORROWED:
        unit.status = LoanUnitStatus.AVAILABLE

    await db.commit()
    await db.refresh(record)
    record = await db.get(
        LoanRecord,
        record.id,
        options=[
            selectinload(LoanRecord.unit).selectinload(LoanUnit.item),
            selectinload(LoanRecord.handled_by),
        ],
    )
    return _record_out(record)


@router.get("/records", response_model=list[LoanRecordOut])
async def list_records(
    db: DbDep,
    _: CheckoutUser,
    record_status: LoanRecordStatus | None = Query(None, alias="status"),
    item_id: uuid.UUID | None = None,
    keyword: str | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> list[LoanRecordOut]:
    q = (
        select(LoanRecord)
        .options(
            selectinload(LoanRecord.unit).selectinload(LoanUnit.item),
            selectinload(LoanRecord.handled_by),
        )
        .order_by(LoanRecord.borrowed_at.desc())
        .limit(limit)
    )
    if record_status:
        q = q.where(LoanRecord.status == record_status)
    if item_id:
        q = q.join(LoanUnit).where(LoanUnit.item_id == item_id)
    if keyword:
        q = q.where(
            LoanRecord.borrower_name.ilike(f"%{keyword}%")
            | LoanRecord.borrower_student_id.ilike(f"%{keyword}%")
        )
    rows = (await db.execute(q)).scalars().all()
    return [_record_out(r) for r in rows]


@router.patch("/records/{record_id}", response_model=LoanRecordOut)
async def update_record(record_id: uuid.UUID, body: LoanRecordUpdate, db: DbDep, _: CheckoutUser) -> LoanRecordOut:
    record = await db.get(
        LoanRecord,
        record_id,
        options=[
            selectinload(LoanRecord.unit).selectinload(LoanUnit.item),
            selectinload(LoanRecord.handled_by),
        ],
    )
    if not record:
        raise HTTPException(status_code=404, detail="借用紀錄不存在")
    if body.due_at is not None:
        record.due_at = body.due_at
    if body.notes is not None:
        record.notes = body.notes
    if body.status is not None:
        record.status = body.status
    await db.commit()
    await db.refresh(record)
    record = await db.get(
        LoanRecord,
        record.id,
        options=[
            selectinload(LoanRecord.unit).selectinload(LoanUnit.item),
            selectinload(LoanRecord.handled_by),
        ],
    )
    return _record_out(record)


# ── 摘要統計 ───────────────────────────────────────────────────────────────────


@router.get("/dashboard", response_model=LoanDashboard)
async def dashboard(db: DbDep, _: CheckoutUser) -> LoanDashboard:
    now = now_local()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    active = await db.scalar(
        select(func.count()).where(LoanRecord.status == LoanRecordStatus.ACTIVE)
    ) or 0
    overdue = await db.scalar(
        select(func.count()).where(LoanRecord.status == LoanRecordStatus.OVERDUE)
    ) or 0
    returned_today = await db.scalar(
        select(func.count()).where(
            LoanRecord.status == LoanRecordStatus.RETURNED,
            LoanRecord.returned_at >= today_start,
        )
    ) or 0
    total_items = await db.scalar(
        select(func.count()).where(LoanItemCategory.is_active == True)  # noqa: E712
    ) or 0
    available_units = await db.scalar(
        select(func.count()).where(LoanUnit.status == LoanUnitStatus.AVAILABLE)
    ) or 0

    return LoanDashboard(
        active_count=active,
        overdue_count=overdue,
        returned_today=returned_today,
        total_items=total_items,
        available_units=available_units,
    )
