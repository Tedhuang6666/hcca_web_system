"""物資管理系統 API：品項、庫存異動、採購申請。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import now_local
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any, require_permission
from api.models.inventory import (
    InventoryCategory,
    InventoryItem,
    InventoryItemType,
    InventoryProcurement,
    InventoryProcurementItem,
    InventoryProcurementStatus,
    InventoryTransaction,
    InventoryTxnType,
)
from api.models.user import User
from api.services.permission import get_user_org_ids_with_permission

router = APIRouter(prefix="/inventory", tags=["物資管理"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.INVENTORY_MANAGE))]
StockUser = Annotated[
    User,
    Depends(require_any(PermissionCode.INVENTORY_MANAGE, PermissionCode.INVENTORY_STOCK)),
]
ViewerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.INVENTORY_MANAGE,
            PermissionCode.INVENTORY_STOCK,
            PermissionCode.INVENTORY_VIEW,
        )
    ),
]


# ── Schemas ────────────────────────────────────────────────────────────────────


class CategoryCreate(BaseModel):
    name: str
    color: str | None = None
    sort_order: int = 0
    org_id: uuid.UUID | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CategoryOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    color: str | None
    sort_order: int
    is_active: bool

    model_config = {"from_attributes": True}


class ItemCreate(BaseModel):
    name: str
    description: str | None = None
    unit: str = "個"
    item_type: InventoryItemType = InventoryItemType.CONSUMABLE
    quantity: int = 0
    low_stock_threshold: int = 0
    location: str | None = None
    image_url: str | None = None
    category_id: uuid.UUID | None = None
    loan_item_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None


class ItemUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    unit: str | None = None
    item_type: InventoryItemType | None = None
    low_stock_threshold: int | None = None
    location: str | None = None
    image_url: str | None = None
    category_id: uuid.UUID | None = None
    loan_item_id: uuid.UUID | None = None
    is_active: bool | None = None


class ItemOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    category_id: uuid.UUID | None
    category_name: str | None = None
    name: str
    description: str | None
    unit: str
    item_type: InventoryItemType
    quantity: int
    low_stock_threshold: int
    is_low_stock: bool = False
    location: str | None
    image_url: str | None
    is_active: bool
    loan_item_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ItemAdjust(BaseModel):
    txn_type: InventoryTxnType
    quantity: int
    notes: str | None = None


class TransactionOut(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    item_name: str = ""
    txn_type: InventoryTxnType
    quantity: int
    quantity_before: int
    quantity_after: int
    notes: str | None
    created_by_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ProcurementItemIn(BaseModel):
    item_id: uuid.UUID | None = None
    item_name: str
    item_unit: str = "個"
    quantity_requested: int
    estimated_unit_price: int | None = None
    notes: str | None = None


class ProcurementCreate(BaseModel):
    title: str
    requester_notes: str | None = None
    estimated_amount: int | None = None
    line_items: list[ProcurementItemIn] = []
    org_id: uuid.UUID | None = None


class ProcurementUpdate(BaseModel):
    title: str | None = None
    requester_notes: str | None = None
    estimated_amount: int | None = None
    line_items: list[ProcurementItemIn] | None = None


class ProcurementItemOut(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID | None
    item_name: str
    item_unit: str
    quantity_requested: int
    quantity_received: int
    estimated_unit_price: int | None
    notes: str | None

    model_config = {"from_attributes": True}


class ProcurementOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    title: str
    status: InventoryProcurementStatus
    estimated_amount: int | None
    requester_id: uuid.UUID
    requester_name: str = ""
    reviewer_id: uuid.UUID | None
    reviewer_name: str | None = None
    reviewed_at: datetime | None
    requester_notes: str | None
    reviewer_notes: str | None
    created_at: datetime
    line_items: list[ProcurementItemOut] = []

    model_config = {"from_attributes": True}


class InventoryDashboard(BaseModel):
    total_items: int
    low_stock_count: int
    pending_procurement_count: int
    monthly_transaction_count: int


class ReceivePayload(BaseModel):
    received_quantities: dict[str, int]  # procurement_item_id -> quantity
    notes: str | None = None


# ── 輔助函式 ───────────────────────────────────────────────────────────────────


def _item_out(item: InventoryItem) -> ItemOut:
    return ItemOut(
        id=item.id,
        org_id=item.org_id,
        category_id=item.category_id,
        category_name=item.category.name if item.category else None,
        name=item.name,
        description=item.description,
        unit=item.unit,
        item_type=item.item_type,
        quantity=item.quantity,
        low_stock_threshold=item.low_stock_threshold,
        is_low_stock=item.is_low_stock,
        location=item.location,
        image_url=item.image_url,
        is_active=item.is_active,
        loan_item_id=item.loan_item_id,
        created_at=item.created_at,
    )


def _txn_out(txn: InventoryTransaction) -> TransactionOut:
    return TransactionOut(
        id=txn.id,
        item_id=txn.item_id,
        item_name=txn.item.name if txn.item else "",
        txn_type=txn.txn_type,
        quantity=txn.quantity,
        quantity_before=txn.quantity_before,
        quantity_after=txn.quantity_after,
        notes=txn.notes,
        created_by_name=txn.created_by.email if txn.created_by else None,
        created_at=txn.created_at,
    )


def _procurement_out(p: InventoryProcurement) -> ProcurementOut:
    return ProcurementOut(
        id=p.id,
        org_id=p.org_id,
        title=p.title,
        status=p.status,
        estimated_amount=p.estimated_amount,
        requester_id=p.requester_id,
        requester_name=p.requester.email if p.requester else "",
        reviewer_id=p.reviewer_id,
        reviewer_name=p.reviewer.email if p.reviewer else None,
        reviewed_at=p.reviewed_at,
        requester_notes=p.requester_notes,
        reviewer_notes=p.reviewer_notes,
        created_at=p.created_at,
        line_items=[ProcurementItemOut.model_validate(li) for li in p.line_items],
    )


async def _get_org_id(db: AsyncSession, user: User, perm: PermissionCode) -> uuid.UUID:
    org_ids = await get_user_org_ids_with_permission(db, user.id, perm)
    if not org_ids:
        raise HTTPException(status_code=403, detail="找不到有物資管理權限的組織")
    return org_ids[0]


async def _record_transaction(
    db: AsyncSession,
    item: InventoryItem,
    txn_type: InventoryTxnType,
    delta: int,
    notes: str | None,
    created_by_id: uuid.UUID,
) -> InventoryTransaction:
    q_before = item.quantity
    item.quantity += delta
    q_after = item.quantity
    txn = InventoryTransaction(
        id=uuid.uuid4(),
        item_id=item.id,
        txn_type=txn_type,
        quantity=delta,
        quantity_before=q_before,
        quantity_after=q_after,
        notes=notes,
        created_by_id=created_by_id,
    )
    db.add(txn)
    return txn


# ── 類別 CRUD ─────────────────────────────────────────────────────────────────


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: DbDep, current_user: ViewerUser) -> list[CategoryOut]:
    rows = (
        await db.execute(
            select(InventoryCategory)
            .where(InventoryCategory.is_active == True)  # noqa: E712
            .order_by(InventoryCategory.sort_order, InventoryCategory.name)
        )
    ).scalars().all()
    return [CategoryOut.model_validate(r) for r in rows]


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryCreate, db: DbDep, current_user: ManagerUser) -> CategoryOut:
    org_id = body.org_id or await _get_org_id(db, current_user, PermissionCode.INVENTORY_MANAGE)
    cat = InventoryCategory(
        id=uuid.uuid4(),
        org_id=org_id,
        name=body.name,
        color=body.color,
        sort_order=body.sort_order,
    )
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return CategoryOut.model_validate(cat)


@router.patch("/categories/{cat_id}", response_model=CategoryOut)
async def update_category(
    cat_id: uuid.UUID, body: CategoryUpdate, db: DbDep, _: ManagerUser
) -> CategoryOut:
    cat = await db.get(InventoryCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="類別不存在")
    if body.name is not None:
        cat.name = body.name
    if body.color is not None:
        cat.color = body.color
    if body.sort_order is not None:
        cat.sort_order = body.sort_order
    if body.is_active is not None:
        cat.is_active = body.is_active
    await db.commit()
    await db.refresh(cat)
    return CategoryOut.model_validate(cat)


@router.delete("/categories/{cat_id}", status_code=204)
async def delete_category(cat_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    cat = await db.get(InventoryCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="類別不存在")
    cat.is_active = False
    await db.commit()


# ── 品項 CRUD ─────────────────────────────────────────────────────────────────


_ITEM_OPTS = [
    selectinload(InventoryItem.category),
    selectinload(InventoryItem.loan_item),
]


@router.get("/items", response_model=list[ItemOut])
async def list_items(
    db: DbDep,
    _: ViewerUser,
    category_id: uuid.UUID | None = None,
    item_type: InventoryItemType | None = None,
    low_stock_only: bool = False,
    keyword: str | None = None,
    include_inactive: bool = False,
) -> list[ItemOut]:
    q = (
        select(InventoryItem)
        .options(*_ITEM_OPTS)
        .order_by(InventoryItem.name)
    )
    if not include_inactive:
        q = q.where(InventoryItem.is_active == True)  # noqa: E712
    if category_id:
        q = q.where(InventoryItem.category_id == category_id)
    if item_type:
        q = q.where(InventoryItem.item_type == item_type)
    if keyword:
        q = q.where(InventoryItem.name.ilike(f"%{keyword}%"))
    rows = (await db.execute(q)).scalars().all()
    result = [_item_out(r) for r in rows]
    if low_stock_only:
        result = [r for r in result if r.is_low_stock]
    return result


@router.post("/items", response_model=ItemOut, status_code=201)
async def create_item(body: ItemCreate, db: DbDep, current_user: ManagerUser) -> ItemOut:
    org_id = body.org_id or await _get_org_id(db, current_user, PermissionCode.INVENTORY_MANAGE)
    item = InventoryItem(
        id=uuid.uuid4(),
        org_id=org_id,
        category_id=body.category_id,
        name=body.name,
        description=body.description,
        unit=body.unit,
        item_type=body.item_type,
        quantity=body.quantity,
        low_stock_threshold=body.low_stock_threshold,
        location=body.location,
        image_url=body.image_url,
        loan_item_id=body.loan_item_id,
    )
    db.add(item)
    if body.quantity > 0:
        await db.flush()
        await _record_transaction(
            db, item, InventoryTxnType.INITIAL, body.quantity, "期初建帳", current_user.id
        )
    await db.commit()
    await db.refresh(item)
    item = await db.get(InventoryItem, item.id, options=_ITEM_OPTS)
    return _item_out(item)


@router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(item_id: uuid.UUID, db: DbDep, _: ViewerUser) -> ItemOut:
    item = await db.get(InventoryItem, item_id, options=_ITEM_OPTS)
    if not item:
        raise HTTPException(status_code=404, detail="品項不存在")
    return _item_out(item)


@router.patch("/items/{item_id}", response_model=ItemOut)
async def update_item(item_id: uuid.UUID, body: ItemUpdate, db: DbDep, _: ManagerUser) -> ItemOut:
    item = await db.get(InventoryItem, item_id, options=_ITEM_OPTS)
    if not item:
        raise HTTPException(status_code=404, detail="品項不存在")
    if body.name is not None:
        item.name = body.name
    if body.description is not None:
        item.description = body.description
    if body.unit is not None:
        item.unit = body.unit
    if body.item_type is not None:
        item.item_type = body.item_type
    if body.low_stock_threshold is not None:
        item.low_stock_threshold = body.low_stock_threshold
    if body.location is not None:
        item.location = body.location
    if body.image_url is not None:
        item.image_url = body.image_url
    if body.category_id is not None:
        item.category_id = body.category_id
    if body.loan_item_id is not None:
        item.loan_item_id = body.loan_item_id
    if body.is_active is not None:
        item.is_active = body.is_active
    await db.commit()
    await db.refresh(item)
    item = await db.get(InventoryItem, item.id, options=_ITEM_OPTS)
    return _item_out(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="品項不存在")
    item.is_active = False
    await db.commit()


@router.post("/items/{item_id}/adjust", response_model=TransactionOut, status_code=201)
async def adjust_stock(
    item_id: uuid.UUID, body: ItemAdjust, db: DbDep, current_user: StockUser
) -> TransactionOut:
    item = await db.get(InventoryItem, item_id, options=_ITEM_OPTS)
    if not item or not item.is_active:
        raise HTTPException(status_code=404, detail="品項不存在")

    # 計算 delta：IN 系列為正，OUT/DAMAGED/LOST 為負
    if body.txn_type in (InventoryTxnType.IN, InventoryTxnType.INITIAL, InventoryTxnType.ADJUSTMENT):
        delta = abs(body.quantity)
    elif body.txn_type in (InventoryTxnType.OUT, InventoryTxnType.DAMAGED, InventoryTxnType.LOST):
        delta = -abs(body.quantity)
    else:
        delta = body.quantity

    if item.quantity + delta < 0:
        raise HTTPException(status_code=400, detail=f"庫存不足，目前剩餘 {item.quantity} {item.unit}")

    txn = await _record_transaction(
        db, item, body.txn_type, delta, body.notes, current_user.id
    )
    await db.commit()
    await db.refresh(txn)
    txn = await db.get(
        InventoryTransaction,
        txn.id,
        options=[selectinload(InventoryTransaction.item), selectinload(InventoryTransaction.created_by)],
    )
    return _txn_out(txn)


@router.get("/items/{item_id}/transactions", response_model=list[TransactionOut])
async def list_item_transactions(
    item_id: uuid.UUID,
    db: DbDep,
    _: ViewerUser,
    limit: int = Query(50, ge=1, le=200),
) -> list[TransactionOut]:
    item = await db.get(InventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="品項不存在")
    rows = (
        await db.execute(
            select(InventoryTransaction)
            .where(InventoryTransaction.item_id == item_id)
            .options(
                selectinload(InventoryTransaction.item),
                selectinload(InventoryTransaction.created_by),
            )
            .order_by(InventoryTransaction.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()
    return [_txn_out(r) for r in rows]


# ── 異動日誌 ───────────────────────────────────────────────────────────────────


@router.get("/transactions", response_model=list[TransactionOut])
async def list_transactions(
    db: DbDep,
    _: ViewerUser,
    item_id: uuid.UUID | None = None,
    txn_type: InventoryTxnType | None = None,
    limit: int = Query(100, ge=1, le=500),
) -> list[TransactionOut]:
    q = (
        select(InventoryTransaction)
        .options(
            selectinload(InventoryTransaction.item),
            selectinload(InventoryTransaction.created_by),
        )
        .order_by(InventoryTransaction.created_at.desc())
        .limit(limit)
    )
    if item_id:
        q = q.where(InventoryTransaction.item_id == item_id)
    if txn_type:
        q = q.where(InventoryTransaction.txn_type == txn_type)
    rows = (await db.execute(q)).scalars().all()
    return [_txn_out(r) for r in rows]


# ── 採購申請 ───────────────────────────────────────────────────────────────────

_PROC_OPTS = [
    selectinload(InventoryProcurement.requester),
    selectinload(InventoryProcurement.reviewer),
    selectinload(InventoryProcurement.line_items),
]


@router.get("/procurements", response_model=list[ProcurementOut])
async def list_procurements(
    db: DbDep,
    current_user: ViewerUser,
    proc_status: InventoryProcurementStatus | None = Query(None, alias="status"),
    own_only: bool = False,
) -> list[ProcurementOut]:
    q = (
        select(InventoryProcurement)
        .options(*_PROC_OPTS)
        .order_by(InventoryProcurement.created_at.desc())
    )
    if proc_status:
        q = q.where(InventoryProcurement.status == proc_status)
    if own_only:
        q = q.where(InventoryProcurement.requester_id == current_user.id)
    rows = (await db.execute(q)).scalars().all()
    return [_procurement_out(r) for r in rows]


@router.post("/procurements", response_model=ProcurementOut, status_code=201)
async def create_procurement(
    body: ProcurementCreate, db: DbDep, current_user: StockUser
) -> ProcurementOut:
    org_id = body.org_id or await _get_org_id(db, current_user, PermissionCode.INVENTORY_STOCK)
    proc = InventoryProcurement(
        id=uuid.uuid4(),
        org_id=org_id,
        title=body.title,
        status=InventoryProcurementStatus.DRAFT,
        estimated_amount=body.estimated_amount,
        requester_id=current_user.id,
        requester_notes=body.requester_notes,
    )
    db.add(proc)
    await db.flush()
    for li in body.line_items:
        db.add(InventoryProcurementItem(
            id=uuid.uuid4(),
            procurement_id=proc.id,
            item_id=li.item_id,
            item_name=li.item_name,
            item_unit=li.item_unit,
            quantity_requested=li.quantity_requested,
            estimated_unit_price=li.estimated_unit_price,
            notes=li.notes,
        ))
    await db.commit()
    proc = await db.get(InventoryProcurement, proc.id, options=_PROC_OPTS)
    return _procurement_out(proc)


@router.get("/procurements/{proc_id}", response_model=ProcurementOut)
async def get_procurement(proc_id: uuid.UUID, db: DbDep, _: ViewerUser) -> ProcurementOut:
    proc = await db.get(InventoryProcurement, proc_id, options=_PROC_OPTS)
    if not proc:
        raise HTTPException(status_code=404, detail="採購申請不存在")
    return _procurement_out(proc)


@router.patch("/procurements/{proc_id}", response_model=ProcurementOut)
async def update_procurement(
    proc_id: uuid.UUID, body: ProcurementUpdate, db: DbDep, current_user: StockUser
) -> ProcurementOut:
    proc = await db.get(InventoryProcurement, proc_id, options=_PROC_OPTS)
    if not proc:
        raise HTTPException(status_code=404, detail="採購申請不存在")
    if proc.status != InventoryProcurementStatus.DRAFT:
        raise HTTPException(status_code=400, detail="只有草稿狀態可以編輯")
    if proc.requester_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有申請人可以編輯草稿")
    if body.title is not None:
        proc.title = body.title
    if body.requester_notes is not None:
        proc.requester_notes = body.requester_notes
    if body.estimated_amount is not None:
        proc.estimated_amount = body.estimated_amount
    if body.line_items is not None:
        for li in proc.line_items:
            await db.delete(li)
        await db.flush()
        for li in body.line_items:
            db.add(InventoryProcurementItem(
                id=uuid.uuid4(),
                procurement_id=proc.id,
                item_id=li.item_id,
                item_name=li.item_name,
                item_unit=li.item_unit,
                quantity_requested=li.quantity_requested,
                estimated_unit_price=li.estimated_unit_price,
                notes=li.notes,
            ))
    await db.commit()
    proc = await db.get(InventoryProcurement, proc.id, options=_PROC_OPTS)
    return _procurement_out(proc)


@router.post("/procurements/{proc_id}/submit", response_model=ProcurementOut)
async def submit_procurement(
    proc_id: uuid.UUID, db: DbDep, current_user: StockUser
) -> ProcurementOut:
    proc = await db.get(InventoryProcurement, proc_id, options=_PROC_OPTS)
    if not proc:
        raise HTTPException(status_code=404, detail="採購申請不存在")
    if proc.status != InventoryProcurementStatus.DRAFT:
        raise HTTPException(status_code=400, detail="只有草稿可以提交")
    if not proc.line_items:
        raise HTTPException(status_code=400, detail="採購清單不能為空")
    proc.status = InventoryProcurementStatus.SUBMITTED
    await db.commit()
    proc = await db.get(InventoryProcurement, proc.id, options=_PROC_OPTS)
    return _procurement_out(proc)


@router.post("/procurements/{proc_id}/approve", response_model=ProcurementOut)
async def approve_procurement(
    proc_id: uuid.UUID, db: DbDep, current_user: ManagerUser
) -> ProcurementOut:
    proc = await db.get(InventoryProcurement, proc_id, options=_PROC_OPTS)
    if not proc:
        raise HTTPException(status_code=404, detail="採購申請不存在")
    if proc.status != InventoryProcurementStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="只有待審狀態可以核准")
    proc.status = InventoryProcurementStatus.APPROVED
    proc.reviewer_id = current_user.id
    proc.reviewed_at = now_local()
    await db.commit()
    proc = await db.get(InventoryProcurement, proc.id, options=_PROC_OPTS)
    return _procurement_out(proc)


@router.post("/procurements/{proc_id}/reject", response_model=ProcurementOut)
async def reject_procurement(
    proc_id: uuid.UUID,
    db: DbDep,
    current_user: ManagerUser,
    reviewer_notes: str | None = None,
) -> ProcurementOut:
    proc = await db.get(InventoryProcurement, proc_id, options=_PROC_OPTS)
    if not proc:
        raise HTTPException(status_code=404, detail="採購申請不存在")
    if proc.status != InventoryProcurementStatus.SUBMITTED:
        raise HTTPException(status_code=400, detail="只有待審狀態可以駁回")
    proc.status = InventoryProcurementStatus.REJECTED
    proc.reviewer_id = current_user.id
    proc.reviewed_at = now_local()
    if reviewer_notes:
        proc.reviewer_notes = reviewer_notes
    await db.commit()
    proc = await db.get(InventoryProcurement, proc.id, options=_PROC_OPTS)
    return _procurement_out(proc)


@router.post("/procurements/{proc_id}/receive", response_model=ProcurementOut)
async def receive_procurement(
    proc_id: uuid.UUID, body: ReceivePayload, db: DbDep, current_user: StockUser
) -> ProcurementOut:
    proc = await db.get(InventoryProcurement, proc_id, options=_PROC_OPTS)
    if not proc:
        raise HTTPException(status_code=404, detail="採購申請不存在")
    if proc.status != InventoryProcurementStatus.APPROVED:
        raise HTTPException(status_code=400, detail="只有已核准的採購可以辦理收貨")

    for li in proc.line_items:
        received = body.received_quantities.get(str(li.id), 0)
        if received <= 0:
            continue
        li.quantity_received = received
        if li.item_id:
            item = await db.get(InventoryItem, li.item_id)
            if item:
                await _record_transaction(
                    db, item, InventoryTxnType.IN, received,
                    f"採購收貨（{proc.title}）{body.notes or ''}".strip(),
                    current_user.id,
                )
    proc.status = InventoryProcurementStatus.RECEIVED
    await db.commit()
    proc = await db.get(InventoryProcurement, proc.id, options=_PROC_OPTS)
    return _procurement_out(proc)


# ── 儀表板 ────────────────────────────────────────────────────────────────────


@router.get("/dashboard", response_model=InventoryDashboard)
async def dashboard(db: DbDep, _: ViewerUser) -> InventoryDashboard:
    total_items = await db.scalar(
        select(func.count()).where(InventoryItem.is_active == True)  # noqa: E712
    ) or 0

    low_stock_count = await db.scalar(
        select(func.count()).where(
            InventoryItem.is_active == True,  # noqa: E712
            InventoryItem.low_stock_threshold > 0,
            InventoryItem.quantity <= InventoryItem.low_stock_threshold,
        )
    ) or 0

    pending_procurement_count = await db.scalar(
        select(func.count()).where(
            InventoryProcurement.status == InventoryProcurementStatus.SUBMITTED
        )
    ) or 0

    now = now_local()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    monthly_transaction_count = await db.scalar(
        select(func.count()).where(
            InventoryTransaction.created_at >= month_start
        )
    ) or 0

    return InventoryDashboard(
        total_items=total_items,
        low_stock_count=low_stock_count,
        pending_procurement_count=pending_procurement_count,
        monthly_transaction_count=monthly_transaction_count,
    )
