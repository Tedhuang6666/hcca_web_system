from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from api.dependencies.permissions import require_any
from api.routers.shop._assisted import _create_assisted_orders
from api.routers.shop._common import (
    _PAYMENT_WRITE_CODES,
    CurrentUser,
    DbDep,
    _class_order_scope_ids,
    _get_class_member_target,
)
from api.schemas.school_class import ClassMemberOut
from api.schemas.shop import (
    ClassOrderCreate,
    CurrentRegistrationUpdate,
    OrderListItem,
    OrderOut,
    ShopClassSummaryOut,
)
from api.services import audit as audit_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _supplements as supplement_svc
from api.services.shop._events import queue_order_updated

router = APIRouter()


@router.get(
    "/orders/class",
    response_model=list[OrderListItem],
    summary="班級幹部檢視本班訂單",
)
async def list_class_orders(
    session: DbDep,
    current_user: CurrentUser,
    is_class_collected: bool | None = Query(None, description="篩選班代個人收款紀錄"),
    assisted_only: bool = Query(False, description="僅顯示班級幹部協助建立的訂單"),
    activity_id: uuid.UUID | None = Query(None, description="篩選活動"),
    category_id: uuid.UUID | None = Query(None, description="篩選未綁活動的商品分類"),
    general_only: bool = Query(False, description="僅顯示未綁活動的訂單"),
    product_id: uuid.UUID | None = Query(None, description="篩選商品"),
    member_user_id: uuid.UUID | None = Query(None, description="篩選特定學生"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    class_ids = await _class_order_scope_ids(session, current_user)
    orders = await shop_svc.list_orders(
        session,
        class_ids=class_ids,
        activity_id=activity_id,
        category_id=category_id,
        general_only=general_only,
        user_id=member_user_id,
        assistance_scope="class_assisted" if assisted_only else None,
        product_id=product_id,
        is_class_collected=is_class_collected,
        limit=limit,
        offset=offset,
    )
    return [shop_svc.serialize_order_list_item(o) for o in orders]


@router.get(
    "/orders/class/members/{member_user_id}/registrations",
    response_model=list[OrderOut],
    summary="班級幹部檢視學生所有有效商品登記",
)
async def list_class_member_registrations(
    member_user_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    target, _, class_ids = await _get_class_member_target(session, current_user, member_user_id)
    orders = await shop_svc.get_class_member_registrations(session, target.id, class_ids)
    return [shop_svc.serialize_order(order) for order in orders]


@router.put(
    "/orders/class/members/{member_user_id}/products/{product_id}",
    response_model=list[OrderOut],
    summary="班級幹部調整學生商品總量",
)
async def set_class_member_product(
    member_user_id: uuid.UUID,
    product_id: uuid.UUID,
    payload: CurrentRegistrationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    target, target_class, class_ids = await _get_class_member_target(
        session, current_user, member_user_id
    )
    previous_orders = await shop_svc.get_class_member_registrations(session, target.id, class_ids)
    try:
        orders = await shop_svc.set_class_member_product(
            session,
            user=target,
            actor=current_user,
            class_id=target_class.id,
            class_ids=class_ids,
            product_id=product_id,
            data=payload,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="商品登記已更新，請重新整理後再試",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    active_order_ids = {order.id for order in orders}
    for previous_order in previous_orders:
        if previous_order.id in active_order_ids:
            continue
        cancelled_order = await shop_svc.get_order(session, previous_order.id)
        if cancelled_order is not None:
            await queue_order_updated(session, cancelled_order)
    for order in orders:
        await queue_order_updated(session, order)
    return [shop_svc.serialize_order(order) for order in orders]


@router.get(
    "/orders/class/summary",
    response_model=ShopClassSummaryOut,
    summary="班級幹部檢視本班商品訂購彙總",
)
async def class_order_summary(
    session: DbDep,
    current_user: CurrentUser,
    is_class_collected: bool | None = Query(None, description="篩選班代個人收款紀錄"),
    assisted_only: bool = Query(False, description="僅顯示班級幹部協助建立的訂單"),
    activity_id: uuid.UUID | None = Query(None, description="篩選活動"),
    category_id: uuid.UUID | None = Query(None, description="篩選未綁活動的商品分類"),
    general_only: bool = Query(False, description="僅顯示未綁活動的訂單"),
    product_id: uuid.UUID | None = Query(None, description="篩選商品"),
) -> ShopClassSummaryOut:
    class_ids = await _class_order_scope_ids(session, current_user)
    return await shop_svc.class_order_summary(
        session,
        class_ids=class_ids,
        activity_id=activity_id,
        category_id=category_id,
        general_only=general_only,
        assistance_scope="class_assisted" if assisted_only else None,
        product_id=product_id,
        is_class_collected=is_class_collected,
    )


@router.post(
    "/orders/class",
    response_model=list[OrderOut],
    status_code=status.HTTP_201_CREATED,
    summary="班級幹部替本班學生建立商品訂單",
)
async def create_class_order(
    payload: ClassOrderCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    return await _create_assisted_orders(payload, session, current_user)


@router.get(
    "/orders/recipients/{class_id}",
    response_model=list[ClassMemberOut],
    summary="訂單管理員查詢代訂學生名冊",
    dependencies=[Depends(require_any(*_PAYMENT_WRITE_CODES))],
)
async def list_order_recipients(class_id: uuid.UUID, session: DbDep) -> list[ClassMemberOut]:
    sc = await class_svc.get_class(session, class_id)
    if sc is None or not sc.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    return await class_svc.list_class_members(session, sc)


@router.post("/orders/{order_id}/separate", response_model=OrderOut, summary="將個別訂單獨立收款")
async def separate_order_collection(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> OrderOut:
    order = await shop_svc.get_order(session, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="找不到此訂單")
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not can_manage and (order.supplement_class_id or order.class_id) not in cadre_ids:
        raise HTTPException(status_code=403, detail="僅班聯或該班班代可獨立收款")
    try:
        order = await supplement_svc.separate_order(session, order, actor_id=current_user.id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_separate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"supplement_class_id": str(order.supplement_class_id)},
        summary=f"將訂單「{order.serial_number}」獨立收款",
    )
    await queue_order_updated(session, order)
    return shop_svc.serialize_order(order)


@router.post(
    "/orders/{order_id}/rejoin-class", response_model=OrderOut, summary="將補收訂單歸回原班"
)
async def rejoin_supplement_order(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> OrderOut:
    order = await shop_svc.get_order(session, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="找不到此訂單")
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not can_manage and order.supplement_class_id not in cadre_ids:
        raise HTTPException(status_code=403, detail="僅班聯或原班班代可將訂單歸回班級")
    try:
        order = await supplement_svc.rejoin_class_order(session, order)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_rejoin_class",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"class_id": str(order.class_id), "is_class_collected": order.is_class_collected},
        summary=f"將訂單「{order.serial_number}」歸回原班級",
    )
    await queue_order_updated(session, order)
    return shop_svc.serialize_order(order)
