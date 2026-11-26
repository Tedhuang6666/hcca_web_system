"""商品目錄分類、系列與品項排序。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Product, ProductCategory, ProductSeries, ProductStatus
from api.schemas.shop import ProductCategoryReorder, ProductReorder, ProductSeriesReorder


async def reorder_categories(
    session: AsyncSession, data: ProductCategoryReorder
) -> list[ProductCategory]:
    if len(data.category_ids) != len(set(data.category_ids)):
        raise ValueError("主題清單有重複項目，請重新載入後再排序。")
    categories = list(
        await session.scalars(
            select(ProductCategory).order_by(ProductCategory.id).with_for_update()
        )
    )
    by_id = {category.id: category for category in categories}
    if set(data.category_ids) != set(by_id):
        raise ValueError("主題清單已變動，請重新載入後再排序。")
    ordered = [by_id[category_id] for category_id in data.category_ids]
    for index, category in enumerate(ordered):
        category.sort_order = index
    await session.flush()
    return ordered


async def reorder_series(session: AsyncSession, data: ProductSeriesReorder) -> list[ProductSeries]:
    if len(data.series_ids) != len(set(data.series_ids)):
        raise ValueError("系列清單有重複項目，請重新載入後再排序。")
    series = list(
        await session.scalars(
            select(ProductSeries)
            .where(ProductSeries.category_id == data.category_id)
            .order_by(ProductSeries.id)
            .with_for_update()
        )
    )
    by_id = {item.id: item for item in series}
    if set(data.series_ids) != set(by_id):
        raise ValueError("系列清單已變動，請重新載入後再排序。")
    ordered = [by_id[series_id] for series_id in data.series_ids]
    for index, item in enumerate(ordered):
        item.sort_order = index
    await session.flush()
    return ordered


async def reorder_products(
    session: AsyncSession, data: ProductReorder, *, include_testing: bool = True
) -> list[Product]:
    if len(data.product_ids) != len(set(data.product_ids)):
        raise ValueError("商品清單有重複項目，請重新載入後再排序。")
    query = select(Product)
    if data.parent_type == "category":
        query = query.where(
            Product.category_id == data.parent_id,
            Product.series_id.is_(None),
        )
    else:
        query = query.where(Product.series_id == data.parent_id)
    products = list(
        await session.scalars(
            query.order_by(Product.sort_order, Product.created_at, Product.id).with_for_update()
        )
    )
    visible_products = [
        product
        for product in products
        if include_testing or product.status != ProductStatus.TESTING
    ]
    by_id = {product.id: product for product in visible_products}
    if set(data.product_ids) != set(by_id):
        raise ValueError("商品清單已變動，請重新載入後再排序。")
    ordered = [by_id[product_id] for product_id in data.product_ids]
    if include_testing:
        ordered_all = ordered
    else:
        ordered_visible = iter(ordered)
        ordered_all = [
            next(ordered_visible) if product.status != ProductStatus.TESTING else product
            for product in products
        ]
    for index, product in enumerate(ordered_all):
        product.sort_order = index
    await session.flush()
    return ordered
