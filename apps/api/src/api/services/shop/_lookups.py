"""校商 HTTP 流程使用的讀取查詢。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.school_class import SchoolClass
from api.models.shop import Product
from api.models.user import User
from api.schemas.shop import ProductPurchaseGroupOptionOut, ProductPurchaseRules


async def get_buyer(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await session.get(User, user_id)


async def get_school_class(session: AsyncSession, class_id: uuid.UUID) -> SchoolClass | None:
    return await session.get(SchoolClass, class_id)


async def selected_classes(session: AsyncSession, class_ids: list[uuid.UUID]) -> list[SchoolClass]:
    return list(
        await session.scalars(
            select(SchoolClass)
            .where(SchoolClass.id.in_(class_ids))
            .order_by(SchoolClass.class_code, SchoolClass.id)
        )
    )


async def purchase_rules(session: AsyncSession, product: Product) -> ProductPurchaseRules:
    rules = ProductPurchaseRules.model_validate(product.purchase_rules or {})
    if rules.exclusive_group:
        rules.exclusive_product_ids = list(
            await session.scalars(
                select(Product.id).where(
                    Product.purchase_rules["exclusive_group"].as_string() == rules.exclusive_group,
                    Product.category_id == product.category_id,
                )
            )
        )
    return rules


async def purchase_group_options(
    session: AsyncSession, category_id: uuid.UUID
) -> list[ProductPurchaseGroupOptionOut]:
    products = await session.execute(
        select(Product.id, Product.name)
        .where(Product.category_id == category_id)
        .order_by(Product.name, Product.id)
    )
    return [ProductPurchaseGroupOptionOut(id=row.id, name=row.name) for row in products]
