"""Exercise the legacy split against real database rows and accounting snapshots."""

from __future__ import annotations

import importlib.util
import os
import uuid
from pathlib import Path

import pytest_asyncio
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from api.models.receivable import Receivable
from api.models.shop import (
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductStatus,
    ShopOrderPromotion,
    ShopPromotion,
)
from api.models.user import User


@pytest_asyncio.fixture
async def db_session():
    """封存 migration 使用退役前結構，整個獨立 schema 隨交易回滾。"""
    url = os.environ["TEST_DATABASE_URL"]
    assert url.startswith("postgresql+asyncpg://"), "Requires PostgreSQL migration schema"
    engine = create_async_engine(url, poolclass=NullPool)
    schema = f"legacy_shop_{uuid.uuid4().hex}"
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                await connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))

                def install_legacy_schema(sync_connection):
                    api_root = Path(__file__).parents[1]
                    config = Config(str(api_root / "alembic.ini"))
                    config.set_main_option("script_location", str(api_root / "alembic"))
                    config.attributes["connection"] = sync_connection
                    config.attributes["bootstrap_baseline"] = True
                    command.upgrade(config, "20261117020000")
                    quote = sync_connection.dialect.identifier_preparer.quote
                    tables = inspect(sync_connection).get_table_names()
                    names = ", ".join(
                        f"{quote(schema)}.{quote(name)}"
                        for name in tables
                        if name != "alembic_version"
                    )
                    sync_connection.exec_driver_sql(f"TRUNCATE {names} RESTART IDENTITY CASCADE")

                await connection.run_sync(install_legacy_schema)
                async with AsyncSession(
                    bind=connection,
                    expire_on_commit=False,
                    join_transaction_mode="create_savepoint",
                ) as session:
                    yield session
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()


def _migration():
    path = (
        Path(__file__).parents[1]
        / "alembic/archive/20261009230000_split_unlinked_shop_activity_orders.py"
    )
    spec = importlib.util.spec_from_file_location("shop_scope_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_legacy_split_preserves_prices_inventory_discounts_and_accounting(db_session):
    buyer = User(email=f"scope-{uuid.uuid4().hex}@example.test", display_name="範例買家")
    db_session.add(buyer)
    await db_session.flush()
    categories = [
        ProductCategory(name=name, created_by=buyer.id) for name in ["聖誕傳情", "校慶商品"]
    ]
    db_session.add_all(categories)
    await db_session.flush()
    products = [
        Product(
            category_id=category.id,
            name=category.name,
            price=price,
            stock_quantity=10,
            status=ProductStatus.ACTIVE,
            created_by=buyer.id,
        )
        for category, price in zip(categories, [40, 994], strict=True)
    ]
    db_session.add_all(products)
    promotion = ShopPromotion(
        name="既有折抵",
        code="LEGACY",
        discount_type="fixed",
        discount_value=17,
        used_count=1,
        created_by=buyer.id,
    )
    db_session.add(promotion)
    await db_session.flush()
    order = Order(
        serial_number="ORD-2026-000006",
        user_id=buyer.id,
        status=OrderStatus.PENDING,
        subtotal_price=4096,
        discount_amount=17,
        total_price=4079,
        promotion_id=promotion.id,
        promotion_code="LEGACY",
        notes="保留備註",
        assistance_scope="class_assisted",
        assisted_by_id=buyer.id,
        items=[
            OrderItem(
                product_id=product.id,
                quantity=qty,
                unit_price=product.price,
                selected_options=[{"option_id": "old", "value": "保留快照"}],
            )
            for product, qty in zip(products, [3, 4], strict=True)
        ],
        applied_promotions=[ShopOrderPromotion(promotion_id=promotion.id, discount_amount=17)],
    )
    protected = Order(
        serial_number="ORD-2026-000007",
        user_id=buyer.id,
        status=OrderStatus.PENDING,
        subtotal_price=1034,
        total_price=1034,
        is_class_collected=True,
        items=[
            OrderItem(product_id=p.id, quantity=1, unit_price=p.price, selected_options=[])
            for p in products
        ],
    )
    reconciled = Order(
        serial_number="ORD-2026-000008",
        user_id=buyer.id,
        status=OrderStatus.PENDING,
        subtotal_price=1034,
        total_price=1034,
        items=[
            OrderItem(product_id=p.id, quantity=1, unit_price=p.price, selected_options=[])
            for p in products
        ],
    )
    db_session.add_all([order, protected, reconciled])
    await db_session.flush()
    original_id = order.id
    original_items = {item.id for item in order.items}
    db_session.add_all(
        [
            Receivable(
                source_type="shop_order",
                source_id=order.id,
                user_id=buyer.id,
                title="原訂單應收",
                amount=4079,
                paid_amount=0,
                refunded_amount=0,
                status="unpaid",
            ),
            Receivable(
                source_type="shop_order",
                source_id=reconciled.id,
                user_id=buyer.id,
                title="部分對帳",
                amount=1034,
                paid_amount=10,
                refunded_amount=0,
                status="partial",
            ),
        ]
    )
    await db_session.flush()
    migration = _migration()
    connection = await db_session.connection()

    def upgrade_legacy_schema(sync_connection):
        sync_connection.execute(text("ALTER TABLE orders DROP COLUMN category_id CASCADE"))
        with Operations.context(MigrationContext.configure(sync_connection)):
            migration.upgrade()

    await connection.run_sync(upgrade_legacy_schema)
    assert await connection.run_sync(migration._split_uncollected_orders) == 0
    rows = list(
        (
            await db_session.scalars(
                select(Order)
                .where(Order.serial_number.in_(["ORD-2026-000006", "ORD-2026-000006-S2"]))
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    assert len(rows) == 2
    assert {row.category_id for row in rows} == {category.id for category in categories}
    assert original_id in {row.id for row in rows}
    assert sum(row.total_price for row in rows) == 4079
    assert sum(row.discount_amount for row in rows) == 17
    assert sum(row.subtotal_price for row in rows) == 4096
    assert all(
        row.assisted_by_id == buyer.id and row.assistance_scope == "class_assisted" for row in rows
    )
    moved_items = list(
        (
            await db_session.scalars(
                select(OrderItem)
                .where(OrderItem.order_id.in_([row.id for row in rows]))
                .execution_options(populate_existing=True)
            )
        ).all()
    )
    assert {item.id for item in moved_items} == original_items
    assert all(item.selected_options[0]["value"] == "保留快照" for item in moved_items)
    assert all(p.stock_quantity == 10 for p in await db_session.scalars(select(Product)))
    receivables = list(
        await db_session.scalars(
            select(Receivable).where(Receivable.source_id.in_([row.id for row in rows]))
        )
    )
    assert len(receivables) == 2
    assert sum(row.amount for row in receivables) == 4079
    assert all(row.paid_amount == 0 for row in receivables)
    for row in rows:
        amounts = list(
            await db_session.scalars(
                select(ShopOrderPromotion.discount_amount).where(
                    ShopOrderPromotion.order_id == row.id
                )
            )
        )
        assert sum(amounts) == row.discount_amount
    assert (
        await db_session.get(ShopPromotion, promotion.id, populate_existing=True)
    ).used_count == 2
    assert (
        len(
            list(
                await db_session.scalars(
                    select(OrderItem).where(OrderItem.order_id == protected.id)
                )
            )
        )
        == 2
    )
    assert (
        len(
            list(
                await db_session.scalars(
                    select(OrderItem).where(OrderItem.order_id == reconciled.id)
                )
            )
        )
        == 2
    )
