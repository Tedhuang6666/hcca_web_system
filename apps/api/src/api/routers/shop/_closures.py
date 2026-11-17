from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User
from api.routers.shop._common import _COUNCIL_CODES, CurrentUser, DbDep, _get_category_or_404
from api.schemas.shop import (
    CloseStatusItem,
    CloseStatusOut,
    ShopOrderCloseCreate,
    ShopOrderCloseOut,
)
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _class_settlement as class_settlement_svc

router = APIRouter()


async def _assert_close_permission(
    session: AsyncSession,
    current_user: User,
) -> None:
    """結單與重新開單僅限班聯管理者，班代及唯讀權限不得操作。"""
    if current_user.is_superuser:
        return
    codes = await get_user_permission_codes(session, current_user.id)
    if _COUNCIL_CODES & set(codes):
        return
    raise HTTPException(status_code=403, detail="無結單權限")


@router.get("/categories/{category_id}/class-deadline", response_model=ShopOrderCloseOut | None)
async def read_class_deadline(
    category_id: uuid.UUID, class_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> ShopOrderCloseOut | None:
    await _get_category_or_404(category_id, session)
    await _assert_close_permission(session, current_user)
    close = await class_settlement_svc.get_class_deadline(session, category_id, class_id)
    return shop_svc._serialize_close(close) if close is not None else None


@router.post(
    "/categories/{category_id}/close",
    response_model=ShopOrderCloseOut,
    status_code=status.HTTP_201_CREATED,
    summary="結單：關閉指定班級（或全局）的訂購",
)
async def close_category(
    category_id: uuid.UUID,
    payload: ShopOrderCloseCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopOrderCloseOut:
    await _get_category_or_404(category_id, session)
    await _assert_close_permission(session, current_user)
    try:
        close = await shop_svc.close_category_for_class(
            session,
            category_id=category_id,
            class_id=payload.class_id,
            closed_by_id=current_user.id,
            notes=payload.notes,
            closes_at=payload.closes_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="shop_category",
        entity_id=str(category_id),
        action="shop.order_close",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "class_id": str(payload.class_id) if payload.class_id else None,
            "closes_at": payload.closes_at.isoformat() if payload.closes_at else None,
        },
        summary=f"結單：商品分類「{category_id}」{'全局' if not payload.class_id else '班級'}",
    )
    return shop_svc._serialize_close(close)


@router.delete(
    "/categories/{category_id}/close",
    response_model=ShopOrderCloseOut,
    summary="重新開單：重開指定班級（或全局）的訂購",
)
async def reopen_category(
    category_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    class_id: uuid.UUID | None = Query(None, description="班級 ID，None=全局"),
) -> ShopOrderCloseOut:
    await _get_category_or_404(category_id, session)
    await _assert_close_permission(session, current_user)
    try:
        close = await shop_svc.reopen_category_for_class(
            session,
            category_id=category_id,
            class_id=class_id,
            reopened_by_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="shop_category",
        entity_id=str(category_id),
        action="shop.order_reopen",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"class_id": str(class_id) if class_id else None},
        summary=f"重新開單：商品分類「{category_id}」",
    )
    return shop_svc._serialize_close(close)


@router.get(
    "/close-status",
    response_model=CloseStatusOut,
    summary="查詢各分類結單狀態",
)
async def get_close_status(
    session: DbDep,
    current_user: CurrentUser,
    category_ids: list[uuid.UUID] = Query(..., description="要查詢的分類 ID 列表"),
    class_id: uuid.UUID | None = Query(None, description="指定班級（不填則用登入者的班）"),
) -> CloseStatusOut:
    from api.services import school_class as class_svc_inner

    # 管理員一次查詢多個班級時，指定的 class_id 已足夠決定資料範圍；
    # 一般使用者仍需解析自己的班級，才能判斷是否可顯示收款細節。
    own_class = None
    if class_id is None or not current_user.is_superuser:
        own_class = await class_svc_inner.resolve_user_class(session, current_user)
    if class_id is None:
        class_id = own_class.id if own_class else None

    close_map = await shop_svc.get_close_status(session, category_ids, class_id)
    collection_details = await shop_svc.get_close_status_collection_details(
        session,
        category_ids,
        class_id if current_user.is_superuser or (own_class and class_id == own_class.id) else None,
    )
    statuses: dict[str, CloseStatusItem] = {}
    for category_id, item in close_map.items():
        status_item = item or CloseStatusItem(is_closed=False)
        details = collection_details.get(category_id)
        if details:
            status_item = status_item.model_copy(update=details)
        statuses[str(category_id)] = status_item
    return CloseStatusOut(statuses=statuses)
