"""商品目錄的共用排序鍵。"""

from __future__ import annotations

import uuid

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Product, ProductCategory, ProductSeries


async def category_catalog_positions(
    session: AsyncSession, category_ids: set[uuid.UUID] | list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    ids = list(dict.fromkeys(category_ids))
    if not ids:
        return {}
    ordered_ids = await session.scalars(
        select(ProductCategory.id)
        .where(ProductCategory.id.in_(ids))
        .order_by(ProductCategory.sort_order, ProductCategory.created_at, ProductCategory.id)
    )
    return {category_id: index for index, category_id in enumerate(ordered_ids)}


def product_catalog_ordering():
    series_category_id = (
        select(ProductSeries.category_id)
        .where(ProductSeries.id == Product.series_id)
        .scalar_subquery()
    )
    category_id = func.coalesce(Product.category_id, series_category_id)
    category_sort_order = (
        select(ProductCategory.sort_order)
        .where(ProductCategory.id == category_id)
        .scalar_subquery()
    )
    category_created_at = (
        select(ProductCategory.created_at)
        .where(ProductCategory.id == category_id)
        .scalar_subquery()
    )
    series_id = Product.series_id
    series_sort_order = (
        select(ProductSeries.sort_order)
        .where(ProductSeries.id == Product.series_id)
        .scalar_subquery()
    )
    series_created_at = (
        select(ProductSeries.created_at)
        .where(ProductSeries.id == Product.series_id)
        .scalar_subquery()
    )
    return (
        func.coalesce(category_sort_order, 0),
        category_created_at,
        category_id,
        case((Product.series_id.is_(None), 0), else_=1),
        series_sort_order,
        series_created_at,
        series_id,
        Product.sort_order,
        Product.created_at,
        Product.id,
    )


async def product_catalog_positions(
    session: AsyncSession, product_ids: set[uuid.UUID] | list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    ids = list(dict.fromkeys(product_ids))
    if not ids:
        return {}
    ordered_ids = await session.scalars(
        select(Product.id).where(Product.id.in_(ids)).order_by(*product_catalog_ordering())
    )
    return {product_id: index for index, product_id in enumerate(ordered_ids)}
