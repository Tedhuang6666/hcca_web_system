from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from api.routers.shop._common import (
    DbDep,
    ManagerUser,
    OptionalUser,
    _get_promotion_or_404,
    _require_promotion_visible,
)
from api.schemas.shop import (
    ShopPromotionCreate,
    ShopPromotionOut,
    ShopPromotionPublicOut,
    ShopPromotionUpdate,
)
from api.services import shop as shop_svc
from api.services.shop._testing import can_test_products

router = APIRouter()


@router.get(
    "/promotions/available",
    response_model=list[ShopPromotionPublicOut],
    summary="列出目前帳號可使用的優惠",
)
async def list_available_promotions(
    session: DbDep,
    current_user: OptionalUser,
) -> list[ShopPromotionPublicOut]:
    promotions = await shop_svc.list_public_promotions(
        session,
        user_id=current_user.id if current_user else None,
        include_testing=await can_test_products(session, current_user),
    )
    return [shop_svc.serialize_public_promotion(promotion) for promotion in promotions]


@router.post(
    "/promotions",
    response_model=ShopPromotionOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立校商優惠",
)
async def create_promotion(
    payload: ShopPromotionCreate, session: DbDep, current_user: ManagerUser
) -> ShopPromotionOut:
    try:
        promotion = await shop_svc.create_promotion(
            session, data=payload, created_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _require_promotion_visible(session, current_user, promotion)
    return shop_svc.serialize_promotion(promotion)


@router.patch("/promotions/{promotion_id}", response_model=ShopPromotionOut, summary="更新校商優惠")
async def update_promotion(
    promotion_id: uuid.UUID,
    payload: ShopPromotionUpdate,
    session: DbDep,
    current_user: ManagerUser,
) -> ShopPromotionOut:
    promotion = await _get_promotion_or_404(promotion_id, session, current_user)
    try:
        updated = await shop_svc.update_promotion(session, promotion, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _require_promotion_visible(session, current_user, updated)
    return shop_svc.serialize_promotion(updated)


@router.delete(
    "/promotions/{promotion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除校商優惠",
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "需要商品管理權限"},
        status.HTTP_404_NOT_FOUND: {"description": "找不到此優惠"},
        status.HTTP_409_CONFLICT: {"description": "優惠已有訂單紀錄，無法刪除"},
    },
)
async def delete_promotion(
    promotion_id: uuid.UUID, session: DbDep, current_user: ManagerUser
) -> None:
    promotion = await _get_promotion_or_404(promotion_id, session, current_user)
    try:
        await shop_svc.delete_promotion(session, promotion)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
