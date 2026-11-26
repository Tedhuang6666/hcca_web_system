from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_permission
from api.models.school_class import SchoolClass
from api.models.shop import (
    Order,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
    ShopPromotion,
)
from api.models.user import User
from api.routers._common import or_404
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _buyer as buyer_svc
from api.services.shop._testing import can_test_products

logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

CurrentUser = Annotated[User, Depends(get_current_active_user)]

OptionalUser = Annotated[User | None, Depends(get_optional_user)]

ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.SHOP_MANAGE))]

_ADMIN_VIEW_CODES = {
    PermissionCode.SHOP_MANAGE,
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.SHOP_VIEW_ALL,
    PermissionCode.FINANCE_VIEW,
    PermissionCode.ADMIN_ALL,
}

_PAYMENT_WRITE_CODES = {
    PermissionCode.SHOP_MANAGE,
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.ADMIN_ALL,
}

_COUNCIL_CODES = {
    PermissionCode.SHOP_MANAGE,
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.ADMIN_ALL,
}


async def _get_category_or_404(category_id: uuid.UUID, session: AsyncSession) -> ProductCategory:
    obj = await shop_svc.get_category(session, category_id)
    return or_404(obj, "找不到此商品分類")


async def _get_series_or_404(series_id: uuid.UUID, session: AsyncSession) -> ProductSeries:
    obj = await shop_svc.get_series(session, series_id)
    return or_404(obj, "找不到此系列")


async def _get_product_or_404(
    product_id: uuid.UUID, session: AsyncSession, current_user: User | None
) -> Product:
    p = await shop_svc.get_product(session, product_id)
    if (
        p is not None
        and p.status == ProductStatus.TESTING
        and not await can_test_products(session, current_user)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    return or_404(p, "找不到此商品")


async def _get_variant_group_or_404(
    group_id: uuid.UUID, session: AsyncSession
) -> ProductVariantGroup:
    g = await shop_svc.get_variant_group(session, group_id)
    return or_404(g, "找不到此變體群組")


async def _get_variant_option_or_404(
    option_id: uuid.UUID, session: AsyncSession
) -> ProductVariantOption:
    o = await shop_svc.get_variant_option(session, option_id)
    return or_404(o, "找不到此變體選項")


async def _get_order_or_404(
    order_id: uuid.UUID, session: AsyncSession, current_user: User
) -> Order:
    o = await shop_svc.get_order(session, order_id)
    if (
        o is not None
        and o.test_product_id is not None
        and not await can_test_products(session, current_user)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return or_404(o, "找不到此訂單")


async def _require_promotion_visible(
    session: AsyncSession, user: User, promotion: ShopPromotion
) -> None:
    if any(
        product.status == ProductStatus.TESTING for product in promotion.target_products
    ) and not await can_test_products(session, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此優惠")


async def _get_promotion_or_404(
    promotion_id: uuid.UUID, session: AsyncSession, current_user: User
) -> ShopPromotion:
    promotion = await shop_svc.get_promotion(session, promotion_id)
    promotion = or_404(promotion, "找不到此優惠")
    await _require_promotion_visible(session, current_user, promotion)
    return promotion


async def _queue_order_confirmation(session: AsyncSession, buyer: User, order: Order) -> None:
    if not buyer.email:
        return
    order_data = shop_svc.serialize_order(order)
    from api.services.outbox import emit as outbox_emit

    await outbox_emit(
        session,
        event_type="shop.order_confirmed",
        payload={
            "order_id": str(order_data.id),
            "serial_number": order_data.serial_number,
            "buyer_id": str(buyer.id),
            "buyer_email": buyer.email,
            "buyer_name": buyer.display_name or "",
            "subtotal_price": order_data.subtotal_price,
            "discount_amount": order_data.discount_amount,
            "promotion_code": order_data.promotion_code,
            "total_price": order_data.total_price,
            "items": [
                {
                    "product_name": item.product_name or "商品",
                    "unit_price": item.unit_price,
                    "quantity": item.quantity,
                    "subtotal": item.subtotal,
                    "selected_options": [
                        option.model_dump(mode="json") for option in item.selected_options
                    ],
                }
                for item in order_data.items
            ],
        },
    )


async def _has_shop_manage(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(session, user.id)
    return str(PermissionCode.SHOP_MANAGE) in codes or str(PermissionCode.ADMIN_ALL) in codes


async def _require_shop_manager(session: AsyncSession, user: User) -> None:
    if await _has_shop_manage(session, user):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：shop:manage")


async def _class_order_scope_ids(session: AsyncSession, user: User) -> list[uuid.UUID]:
    return await buyer_svc._class_order_scope_ids(session, user)


async def _get_class_member_target(
    session: AsyncSession, current_user: User, member_user_id: uuid.UUID
) -> tuple[User, SchoolClass, list[uuid.UUID]]:
    try:
        return await buyer_svc._get_class_member_target(session, current_user, member_user_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


async def _class_purchase_buyer(
    session: AsyncSession, actor: User | None, member_id: uuid.UUID | None
) -> User | None:
    try:
        return await buyer_svc._class_purchase_buyer(session, actor, member_id)
    except buyer_svc.BuyerAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
