"""共用收款對帳中心 API。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.receivable import (
    ReceivableCreate,
    ReceivableOut,
    ReceivablePaymentIn,
    ReceivableRefundIn,
    ReceivableSummaryOut,
    ReceivableUpdate,
)
from api.services import audit as audit_svc
from api.services import receivable as receivable_svc

router = APIRouter(prefix="/receivables", tags=["收款對帳"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get(
    "",
    response_model=list[ReceivableOut],
    summary="列出應收款（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def list_receivables(
    db: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
) -> list[ReceivableOut]:
    rows = await receivable_svc.list_receivables(
        db,
        activity_id=activity_id,
        class_id=class_id,
        user_id=user_id,
        status=status_filter,
        limit=limit,
    )
    return [ReceivableOut.model_validate(row) for row in rows]


@router.get(
    "/summary",
    response_model=ReceivableSummaryOut,
    summary="取得應收款摘要（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def receivable_summary(
    db: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
) -> ReceivableSummaryOut:
    return ReceivableSummaryOut(
        **await receivable_svc.summary(db, activity_id=activity_id, class_id=class_id)
    )


@router.post(
    "",
    response_model=ReceivableOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立應收款（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def create_receivable(
    body: ReceivableCreate, db: DbDep, current_user: CurrentUser
) -> ReceivableOut:
    item = await receivable_svc.create_receivable(db, body)
    await audit_svc.record(
        db,
        entity_type="receivable",
        entity_id=str(item.id),
        action="receivable.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary=f"建立應收款：{item.title}",
    )
    return ReceivableOut.model_validate(item)


@router.patch(
    "/{receivable_id}",
    response_model=ReceivableOut,
    summary="更新應收款（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def update_receivable(
    receivable_id: uuid.UUID,
    body: ReceivableUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> ReceivableOut:
    item = await receivable_svc.get_receivable(db, receivable_id)
    if item is None:
        raise HTTPException(status_code=404, detail="應收款不存在")
    item = await receivable_svc.update_receivable(db, item, body)
    await audit_svc.record(
        db,
        entity_type="receivable",
        entity_id=str(item.id),
        action="receivable.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json", exclude_unset=True),
        summary=f"更新應收款：{item.title}",
    )
    return ReceivableOut.model_validate(item)


@router.post(
    "/{receivable_id}/mark-paid",
    response_model=ReceivableOut,
    summary="標記收款完成（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def mark_paid(
    receivable_id: uuid.UUID,
    body: ReceivablePaymentIn,
    db: DbDep,
    current_user: CurrentUser,
) -> ReceivableOut:
    item = await receivable_svc.get_receivable(db, receivable_id)
    if item is None:
        raise HTTPException(status_code=404, detail="應收款不存在")
    item = await receivable_svc.mark_paid(
        db, item, actor_id=current_user.id, paid_amount=body.paid_amount, note=body.note
    )
    await audit_svc.record(
        db,
        entity_type="receivable",
        entity_id=str(item.id),
        action="receivable.mark_paid",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"標記收款：{item.title}",
    )
    return ReceivableOut.model_validate(item)


@router.post(
    "/{receivable_id}/refund",
    response_model=ReceivableOut,
    summary="標記退款（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def refund(
    receivable_id: uuid.UUID,
    body: ReceivableRefundIn,
    db: DbDep,
    current_user: CurrentUser,
) -> ReceivableOut:
    item = await receivable_svc.get_receivable(db, receivable_id)
    if item is None:
        raise HTTPException(status_code=404, detail="應收款不存在")
    item = await receivable_svc.refund(
        db,
        item,
        actor_id=current_user.id,
        refunded_amount=body.refunded_amount,
        note=body.note,
    )
    await audit_svc.record(
        db,
        entity_type="receivable",
        entity_id=str(item.id),
        action="receivable.refund",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"標記退款：{item.title}",
    )
    return ReceivableOut.model_validate(item)


@router.get(
    "/export.csv",
    summary="匯出應收款 CSV（需 finance:view）",
    dependencies=[Depends(require_permission("finance:view"))],
)
async def export_receivables_csv(
    db: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = None,
    class_id: uuid.UUID | None = None,
) -> Response:
    rows = await receivable_svc.list_receivables(
        db, activity_id=activity_id, class_id=class_id, limit=500
    )
    csv_text = await receivable_svc.export_csv(db, rows)
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="receivables.csv"'},
    )
