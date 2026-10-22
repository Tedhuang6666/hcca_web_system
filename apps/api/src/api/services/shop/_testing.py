"""商品測試權限與測試階段切換。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.permission_codes import PermissionCode
from api.models.shop import OrderItem, Product, ProductStatus
from api.models.user import User
from api.services.permission import get_user_permission_codes


async def can_test_products(session: AsyncSession, user: User | None) -> bool:
    if user is None:
        return False
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(session, user.id)
    return bool({PermissionCode.SHOP_TEST, PermissionCode.ADMIN_ALL} & codes)


async def start_product_testing(session: AsyncSession, product: Product) -> Product:
    await session.refresh(product, attribute_names=["status", "version"], with_for_update=True)
    if product.status not in (ProductStatus.DRAFT, ProductStatus.CANCELLED):
        raise ValueError("只有草稿或已下架商品可以開始測試")
    history = await session.scalar(
        select(OrderItem.id).where(OrderItem.product_id == product.id).limit(1)
    )
    if history is not None:
        raise ValueError("已有正式訂購紀錄的商品無法改為測試中")
    product.status = ProductStatus.TESTING
    await session.flush()
    return product
