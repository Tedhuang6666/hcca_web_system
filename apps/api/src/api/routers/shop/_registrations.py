from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm.exc import StaleDataError

from api.routers.shop._common import CurrentUser, DbDep, _require_promotion_visible
from api.schemas.shop import (
    CurrentRegistrationUpdate,
    OrderOut,
    ShopPromotionPreviewOut,
    ShopPromotionPreviewRequest,
)
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.shop._events import queue_order_updated
from api.services.shop._testing import can_test_products

router = APIRouter()


@router.get(
    "/registrations",
    response_model=list[OrderOut],
    summary="取得各活動目前商品登記",
)
async def list_current_registrations(session: DbDep, current_user: CurrentUser) -> list[OrderOut]:
    orders = await shop_svc.get_current_registrations(
        session, current_user.id, include_testing=await can_test_products(session, current_user)
    )
    return [shop_svc.serialize_order(order) for order in orders]


@router.get(
    "/registrations/current",
    response_model=OrderOut | None,
    summary="取得目前商品登記",
)
async def get_current_registration(session: DbDep, current_user: CurrentUser) -> OrderOut | None:
    order = await shop_svc.get_current_registration(session, current_user.id)
    return shop_svc.serialize_order(order) if order else None


@router.post(
    "/registrations/current/promotion/preview",
    response_model=ShopPromotionPreviewOut,
    summary="預覽目前商品登記的優惠",
)
async def preview_current_registration_promotion(
    payload: ShopPromotionPreviewRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopPromotionPreviewOut:
    result = await shop_svc.preview_registration_promotion(
        session,
        user_id=current_user.id,
        code=payload.code,
        activity_id=payload.activity_id,
        category_id=payload.category_id,
    )
    if result.promotion is not None:
        await _require_promotion_visible(session, current_user, result.promotion)
    return result.output


@router.put(
    "/registrations/current/promotion",
    response_model=OrderOut,
    summary="套用目前商品登記的優惠",
)
async def apply_current_registration_promotion(
    payload: ShopPromotionPreviewRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    try:
        order = await shop_svc.apply_registration_promotion(
            session,
            current_user,
            code=payload.code,
            activity_id=payload.activity_id,
            category_id=payload.category_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return shop_svc.serialize_order(order)


@router.put(
    "/registrations/current/products/{product_id}",
    response_model=OrderOut | None,
    summary="立即更新商品登記",
)
async def update_current_registration_product(
    product_id: uuid.UUID,
    payload: CurrentRegistrationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut | None:
    try:
        order = await shop_svc.set_current_registration_product(
            session,
            current_user,
            product_id,
            data=payload,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except StaleDataError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="庫存已更新，請重新載入"
        ) from e
    except shop_svc.PurchaseLimitError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    if order is None:
        return None
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.registration_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "product_id": str(product_id)},
        summary=f"更新商品登記「{order.serial_number}」",
    )
    full = await shop_svc.get_order(session, order.id)
    updated = full or order
    await queue_order_updated(session, updated)
    return shop_svc.serialize_order(updated)
