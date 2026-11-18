from __future__ import annotations

import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm.exc import StaleDataError

from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.routers._common import or_404
from api.routers.shop._common import (
    _ADMIN_VIEW_CODES,
    _PAYMENT_WRITE_CODES,
    CurrentUser,
    DbDep,
    _get_order_or_404,
    _queue_order_confirmation,
    _require_shop_manager,
)
from api.schemas.shop import (
    ClassCollectionUpdate,
    ClassOrderUpsert,
    ClassPaymentOut,
    ClassPaymentUpdate,
    OrderCancelRequest,
    OrderOut,
    OrderPaymentUpdate,
    OrderRecalculateItem,
    OrderRecalculateOut,
    OrderRecalculateRequest,
)
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _delegation as delegation_svc
from api.services.shop import _lookups as lookups_svc
from api.services.shop._events import queue_order_updated
from api.services.shop._promotion_orders import recalculate_orders

router = APIRouter()


@router.post(
    "/orders/recalculate-promotions",
    response_model=OrderRecalculateOut,
    summary="手動重算指定訂單的優惠",
)
async def recalculate_order_promotions(
    payload: OrderRecalculateRequest, session: DbDep, current_user: CurrentUser
) -> OrderRecalculateOut:
    orders = [await shop_svc.get_order(session, order_id) for order_id in payload.order_ids]
    for order in orders:
        if order is not None:
            await _require_shop_manager(session, current_user, shop_svc._order_activity_id(order))
    results = await recalculate_orders(session, payload.order_ids)
    for row in results:
        if row.status != "updated":
            continue
        await audit_svc.record(
            session,
            entity_type="order",
            entity_id=str(row.order_id),
            action="shop.order_recalculate",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"old_total": row.old_total, "new_total": row.new_total},
            summary=f"手動重算訂單「{row.serial_number}」優惠",
        )
        refreshed = await shop_svc.get_order(session, row.order_id)
        if refreshed is not None:
            await queue_order_updated(session, refreshed)
    items = [OrderRecalculateItem(**vars(row)) for row in results]
    return OrderRecalculateOut(
        results=items,
        updated=sum(row.status == "updated" for row in items),
        unchanged=sum(row.status == "unchanged" for row in items),
        skipped=sum(row.status == "skipped" for row in items),
    )


@router.get("/orders/{order_id}", response_model=OrderOut, summary="取得訂單詳情")
async def get_order(order_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    if order.user_id != current_user.id and not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_cadre = order.class_id is not None and order.class_id in cadre_ids
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, shop_svc._order_activity_id(order)
        )
        is_bound_delegate = await delegation_svc.can_view_order(session, current_user, order)
        if (
            not (_ADMIN_VIEW_CODES & set(codes))
            and not is_cadre
            and not is_activity_manager
            and not is_bound_delegate
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return shop_svc.serialize_order(order)


@router.post("/orders/{order_id}/cancel", response_model=OrderOut, summary="取消訂單")
async def cancel_order(
    order_id: uuid.UUID,
    payload: OrderCancelRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    codes = await get_user_permission_codes(session, current_user.id)
    is_order_manager = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    is_class_cadre = False
    if not is_order_manager:
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_class_cadre = order.class_id is not None and order.class_id in cadre_ids
        if order.user_id != current_user.id and not is_class_cadre:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權取消此訂單")
    try:
        order = await shop_svc.cancel_order(
            session,
            order,
            requested_by=current_user.id,
            reason=payload.reason,
            bypass_owner_check=is_order_manager or is_class_cadre,
            bypass_registration_window=is_order_manager or is_class_cadre,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_cancel",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "reason": payload.reason},
        summary=f"取消商品訂單「{order.serial_number}」",
    )
    refreshed = await shop_svc.get_order(session, order.id)
    updated = refreshed or order
    await queue_order_updated(session, updated)
    return shop_svc.serialize_order(updated)


@router.patch("/orders/{order_id}", response_model=OrderOut, summary="截止前修改訂單品項")
async def update_order_items(
    order_id: uuid.UUID,
    payload: ClassOrderUpsert,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    is_cadre_of_class = order.class_id is not None and order.class_id in cadre_ids
    if order.user_id != current_user.id and not current_user.is_superuser and not is_cadre_of_class:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權修改此訂單")
    try:
        order = await shop_svc.replace_order_items(
            session,
            order,
            data=payload,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    refreshed = await shop_svc.get_order(session, order.id)
    updated = refreshed or order
    await queue_order_updated(session, updated)
    return shop_svc.serialize_order(updated)


@router.patch(
    "/orders/{order_id}/collection", response_model=OrderOut, summary="班代紀錄本班學生收款"
)
async def update_class_collection(
    order_id: uuid.UUID,
    payload: ClassCollectionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    was_class_collected = order.is_class_collected
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not current_user.is_superuser and (
        order.class_id is None or order.class_id not in cadre_ids
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="僅該班班代可紀錄收款")
    try:
        order = await shop_svc.set_class_collected(
            session, order, collected=payload.is_class_collected, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.class_collection",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"is_class_collected": payload.is_class_collected},
        summary=f"班代紀錄訂單「{order.serial_number}」收款狀態",
    )
    full = await shop_svc.get_order(session, order.id)
    updated = full or order
    if payload.is_class_collected and not was_class_collected:
        buyer = await lookups_svc.get_buyer(session, updated.user_id)
        if buyer is not None:
            await _queue_order_confirmation(session, buyer, updated)
    await queue_order_updated(session, updated)
    return shop_svc.serialize_order(updated)


@router.get(
    "/orders/classes/{class_id}/receipt.pdf",
    summary="下載班級收款簽收單（收執聯與存根聯）",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_class_receipt(
    class_id: uuid.UUID,
    session: DbDep,
    activity_id: uuid.UUID | None = Query(None, description="活動；未提供時僅匯出一般商品"),
) -> Response:
    school_class = await lookups_svc.get_school_class(session, class_id)
    if school_class is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    try:
        pdf = await shop_svc.export_class_receipt_pdf(
            session, school_class, activity_id=activity_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename = f"班聯收款簽收單-{school_class.class_code}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "no-store",
        },
    )


@router.patch(
    "/orders/classes/{class_id}/payment",
    response_model=ClassPaymentOut,
    summary="班聯會確認整班繳款",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def update_class_payment(
    class_id: uuid.UUID,
    payload: ClassPaymentUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ClassPaymentOut:
    if await lookups_svc.get_school_class(session, class_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    if payload.activity_id is not None:
        or_404(await activity_svc.get_activity(session, payload.activity_id), "找不到此活動")
    try:
        orders = await shop_svc.set_class_paid(
            session,
            class_id,
            is_paid=payload.is_paid,
            actor_id=current_user.id,
            activity_id=payload.activity_id,
            category_id=payload.category_id,
            received_amount=payload.received_amount,
            expected_unpaid_amount=payload.expected_unpaid_amount,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await audit_svc.record(
        session,
        entity_type="school_class",
        entity_id=str(class_id),
        action="shop.class_payment",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "is_paid": payload.is_paid,
            "received_amount": payload.received_amount,
            "order_count": len(orders),
            "activity_id": str(payload.activity_id) if payload.activity_id else None,
            "category_id": str(payload.category_id) if payload.category_id else None,
        },
        summary=f"班聯會{'登記' if payload.is_paid else '撤銷'}班級收款（單一活動）",
    )
    for order in orders:
        await queue_order_updated(session, order)
    return ClassPaymentOut(
        class_id=class_id,
        activity_id=payload.activity_id,
        category_id=payload.category_id,
        updated_orders=len(orders),
        is_paid=all(order.is_paid for order in orders) if orders else payload.is_paid,
    )


@router.patch(
    "/orders/{order_id}/payment", response_model=OrderOut, summary="管理員標示單筆訂單是否已繳費"
)
async def update_order_payment(
    order_id: uuid.UUID,
    payload: OrderPaymentUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, shop_svc._order_activity_id(order)
        )
        if not (_PAYMENT_WRITE_CODES & set(codes)) and not is_activity_manager:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="僅班聯會管理員可標示正式繳費"
            )
    try:
        order = await shop_svc.set_order_paid(
            session, order, is_paid=payload.is_paid, actor_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_payment",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "is_paid": payload.is_paid},
        summary=f"標示訂單「{order.serial_number}」{'已繳費' if payload.is_paid else '未繳費'}",
    )
    refreshed = await shop_svc.get_order(session, order.id)
    updated = refreshed or order
    await queue_order_updated(session, updated)
    return shop_svc.serialize_order(updated)
