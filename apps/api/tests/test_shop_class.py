"""商品分類 / 變體 / 購物車 / 結單 與 班級系統測試（服務層）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import Order, OrderItem, OrderStatus, Product
from api.models.user import User
from api.schemas.school_class import (
    ClassManualMemberCreate,
    ClassStudentRangeCreate,
    ClassStudentRangeOverride,
    SchoolClassBulkCreate,
    SchoolClassBulkGradeCreate,
    SchoolClassCreate,
    SchoolClassUpdate,
)
from api.schemas.shop import (
    CartItemCreate,
    ProductCategoryCreate,
    ProductCreate,
    ProductSeriesCreate,
    ProductVariantGroupCreate,
    ProductVariantOptionCreate,
)
from api.services import school_class as class_svc
from api.services import shop as shop_svc

# ── 測試輔助 ──────────────────────────────────────────────────────────────────


async def _make_user(db: AsyncSession, *, student_id: str | None = None) -> User:
    user = User(
        email=f"u-{uuid.uuid4().hex[:8]}@test.edu",
        display_name="測試學生",
        student_id=student_id,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_actor(db: AsyncSession) -> uuid.UUID:
    """建立真實 user 並回傳 id，供 created_by / actor_id 等 FK 欄位使用。"""
    user = await _make_user(db)
    return user.id


async def _make_class(db: AsyncSession, *, start: str = "11501", end: str = "11540") -> object:
    return await class_svc.create_class(
        db,
        data=SchoolClassCreate(
            academic_year=115,
            class_code="115",
            grade=1,
            ranges=[ClassStudentRangeCreate(student_id_start=start, student_id_end=end)],
        ),
        created_by=await _make_actor(db),
    )


async def _make_product(
    db: AsyncSession, *, price: int = 100, stock: int = 50, sale_end: datetime | None = None
) -> Product:
    creator = await _make_actor(db)
    category = await shop_svc.create_category(
        db, data=ProductCategoryCreate(name="商品"), created_by=creator
    )
    series = await shop_svc.create_series(
        db, data=ProductSeriesCreate(category_id=category.id, name="衣服系列")
    )
    product = await shop_svc.create_product(
        db,
        data=ProductCreate(
            series_id=series.id,
            name="短袖衣服",
            price=price,
            stock_quantity=stock,
            sale_end=sale_end,
            variant_groups=[
                ProductVariantGroupCreate(
                    name="顏色",
                    options=[
                        ProductVariantOptionCreate(value="黑"),
                        ProductVariantOptionCreate(value="白"),
                    ],
                ),
                ProductVariantGroupCreate(
                    name="尺寸",
                    options=[
                        ProductVariantOptionCreate(value="中"),
                        ProductVariantOptionCreate(value="XL", price_delta=50),
                    ],
                ),
            ],
        ),
        created_by=creator,
    )
    await shop_svc.activate_product(db, product)
    return await shop_svc.get_product(db, product.id)  # type: ignore[return-value]


def _option_ids(product: Product, color: str, size: str) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    for group in product.variant_groups:
        wanted = color if group.name == "顏色" else size
        ids.append(next(o.id for o in group.options if o.value == wanted))
    return ids


# ── 班級：學號區間自動歸班 ────────────────────────────────────────────────────


async def test_resolve_user_class_matches_student_id_in_range(db_session: AsyncSession) -> None:
    sc = await _make_class(db_session, start="11501", end="11540")
    in_user = await _make_user(db_session, student_id="11520")
    out_user = await _make_user(db_session, student_id="11599")
    no_id_user = await _make_user(db_session, student_id=None)

    resolved = await class_svc.resolve_user_class(db_session, in_user)
    assert resolved is not None
    assert resolved.id == sc.id
    assert await class_svc.resolve_user_class(db_session, out_user) is None
    assert await class_svc.resolve_user_class(db_session, no_id_user) is None


async def test_inactive_class_excluded_from_resolution(db_session: AsyncSession) -> None:
    sc = await _make_class(db_session)
    await class_svc.update_class(db_session, sc, data=SchoolClassUpdate(is_active=False))
    user = await _make_user(db_session, student_id="11520")
    assert await class_svc.resolve_user_class(db_session, user) is None


async def test_add_cadre_and_lookup_cadre_class_ids(db_session: AsyncSession) -> None:
    sc = await _make_class(db_session)
    user = await _make_user(db_session, student_id="11501")
    await class_svc.add_cadre(db_session, sc, user_id=user.id)

    assert sc.id in await class_svc.get_cadre_class_ids(db_session, user.id)
    with pytest.raises(ValueError, match="已是該班幹部"):
        await class_svc.add_cadre(db_session, sc, user_id=user.id)


async def test_list_class_members_flags_cadre(db_session: AsyncSession) -> None:
    sc = await _make_class(db_session, start="11501", end="11510")
    member = await _make_user(db_session, student_id="11505")
    await _make_user(db_session, student_id="19999")  # 區間外
    await class_svc.add_cadre(db_session, sc, user_id=member.id)

    members = await class_svc.list_class_members(
        db_session, await class_svc.get_class(db_session, sc.id)
    )
    assert [m.student_id for m in members] == ["11505"]
    assert members[0].is_cadre is True


async def test_manual_member_can_be_added_and_promoted_to_cadre(
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session, start="11501", end="11510")
    user = await _make_user(db_session, student_id=None)

    await class_svc.add_manual_member(db_session, sc, data=ClassManualMemberCreate(user_id=user.id))
    await class_svc.add_cadre(db_session, sc, user_id=user.id)

    members = await class_svc.list_class_members(
        db_session, await class_svc.get_class(db_session, sc.id)
    )
    assert [m.id for m in members] == [user.id]
    assert members[0].source == "manual"
    assert members[0].is_cadre is True
    assert await class_svc.resolve_user_class(db_session, user) is not None


async def test_cadre_requires_class_member(db_session: AsyncSession) -> None:
    sc = await _make_class(db_session, start="11501", end="11510")
    user = await _make_user(db_session, student_id="11599")

    with pytest.raises(ValueError, match="先將此使用者加入班級"):
        await class_svc.add_cadre(db_session, sc, user_id=user.id)


async def test_bulk_create_classes_builds_class_codes_and_student_ranges(
    db_session: AsyncSession,
) -> None:
    result = await class_svc.bulk_create_classes(
        db_session,
        data=SchoolClassBulkCreate(
            academic_year=115,
            grades=[SchoolClassBulkGradeCreate(grade=1, class_start=1, class_end=2)],
        ),
        created_by=await _make_actor(db_session),
    )

    assert result.succeeded == 2
    classes = await class_svc.list_classes(db_session, academic_year=115)
    assert [c.class_code for c in classes] == ["101", "102"]
    assert classes[0].ranges[0].student_id_start == "11510101"
    assert classes[0].ranges[0].student_id_end == "11510140"


async def test_bulk_create_classes_allows_per_class_student_count_override(
    db_session: AsyncSession,
) -> None:
    result = await class_svc.bulk_create_classes(
        db_session,
        data=SchoolClassBulkCreate(
            academic_year=116,
            grades=[
                SchoolClassBulkGradeCreate(
                    grade=1,
                    class_start=1,
                    class_end=2,
                    class_overrides=[
                        ClassStudentRangeOverride(class_no=2, student_no_start=1, student_no_end=35)
                    ],
                )
            ],
        ),
        created_by=await _make_actor(db_session),
    )

    assert result.succeeded == 2
    classes = await class_svc.list_classes(db_session, academic_year=116)
    by_code = {c.class_code: c for c in classes}
    assert by_code["101"].ranges[0].student_id_end == "11610140"
    assert by_code["102"].ranges[0].student_id_end == "11610235"


# ── 商品：分類階層與變體 ──────────────────────────────────────────────────────


async def test_build_catalog_tree_includes_active_product_with_variants(
    db_session: AsyncSession,
) -> None:
    await _make_product(db_session)
    tree = await shop_svc.build_catalog_tree(db_session)
    assert len(tree) == 1
    assert tree[0].name == "商品"
    assert tree[0].series[0].products[0].has_variants is True


async def test_add_cart_item_requires_one_option_per_variant_group(
    db_session: AsyncSession,
) -> None:
    product = await _make_product(db_session)
    user = await _make_user(db_session)
    with pytest.raises(ValueError, match="需選擇一個選項"):
        await shop_svc.add_cart_item(
            db_session, user.id, data=CartItemCreate(product_id=product.id, quantity=1)
        )


async def test_cart_unit_price_includes_variant_price_delta(db_session: AsyncSession) -> None:
    product = await _make_product(db_session, price=100)
    user = await _make_user(db_session)
    cart = await shop_svc.add_cart_item(
        db_session,
        user.id,
        data=CartItemCreate(
            product_id=product.id, quantity=2, option_ids=_option_ids(product, "黑", "XL")
        ),
    )
    out = shop_svc.serialize_cart(cart)
    assert len(out.items) == 1
    assert out.items[0].unit_price == 150  # 商品 100 + XL 加價 50
    assert out.items[0].subtotal == 300
    assert out.total_price == 300


async def test_add_same_product_same_variant_merges_quantity(db_session: AsyncSession) -> None:
    product = await _make_product(db_session)
    user = await _make_user(db_session)
    payload = CartItemCreate(
        product_id=product.id, quantity=1, option_ids=_option_ids(product, "黑", "中")
    )
    await shop_svc.add_cart_item(db_session, user.id, data=payload)
    cart = await shop_svc.add_cart_item(db_session, user.id, data=payload)
    out = shop_svc.serialize_cart(cart)
    assert len(out.items) == 1
    assert out.items[0].quantity == 2


# ── 結單：班級歸戶 / 變體計價 / 截止 ──────────────────────────────────────────


async def test_checkout_snapshots_class_and_variant_price(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    counter = {"n": 0}

    async def _fake_serial(_session: AsyncSession) -> str:
        counter["n"] += 1
        return f"ORD-TEST-{counter['n']:04d}"

    from api.services.shop import _orders

    monkeypatch.setattr(_orders, "generate_order_serial", _fake_serial)

    sc = await _make_class(db_session, start="11501", end="11540")
    user = await _make_user(db_session, student_id="11510")
    product = await _make_product(db_session, price=100, stock=10)
    await shop_svc.add_cart_item(
        db_session,
        user.id,
        data=CartItemCreate(
            product_id=product.id, quantity=2, option_ids=_option_ids(product, "黑", "XL")
        ),
    )

    orders = await shop_svc.checkout(db_session, user, notes="測試")
    assert len(orders) == 1
    assert orders[0].class_id == sc.id
    assert orders[0].total_price == 300  # (100 + 50) * 2

    refreshed = await shop_svc.get_product(db_session, product.id)
    assert refreshed.stock_quantity == 8  # 庫存已扣減

    cart = await shop_svc.get_or_create_cart(db_session, user.id)
    assert cart.items == []  # 購物車已清空


async def test_checkout_after_sale_end_is_rejected(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_serial(_session: AsyncSession) -> str:
        return "ORD-TEST-9999"

    from api.services.shop import _orders

    monkeypatch.setattr(_orders, "generate_order_serial", _fake_serial)

    user = await _make_user(db_session, student_id="11510")
    product = await _make_product(db_session, sale_end=datetime.now(UTC) - timedelta(hours=1))
    await shop_svc.add_cart_item(
        db_session,
        user.id,
        data=CartItemCreate(
            product_id=product.id, quantity=1, option_ids=_option_ids(product, "黑", "中")
        ),
    )
    with pytest.raises(ValueError, match="已截止販售"):
        await shop_svc.checkout(db_session, user)


# ── 訂單：繳費標示與後台統計 ──────────────────────────────────────────────────


async def test_set_order_paid_can_toggle_both_directions(db_session: AsyncSession) -> None:
    buyer = await _make_user(db_session)
    order = Order(
        serial_number="ORD-PAY-1",
        user_id=buyer.id,
        status=OrderStatus.PENDING,
        total_price=100,
    )
    db_session.add(order)
    await db_session.flush()
    actor = await _make_actor(db_session)

    await shop_svc.set_order_paid(db_session, order, is_paid=True, actor_id=actor)
    assert order.is_paid is True
    assert order.paid_at is not None
    assert order.paid_by_id == actor

    await shop_svc.set_order_paid(db_session, order, is_paid=False, actor_id=actor)
    assert order.is_paid is False
    assert order.paid_at is None
    assert order.paid_by_id is None


async def test_order_summary_groups_by_class_with_paid_split(db_session: AsyncSession) -> None:
    sc = await _make_class(db_session)
    buyer = await _make_user(db_session)
    db_session.add_all(
        [
            Order(
                serial_number="ORD-S-1",
                user_id=buyer.id,
                class_id=sc.id,
                status=OrderStatus.PENDING,
                total_price=200,
                is_paid=True,
            ),
            Order(
                serial_number="ORD-S-2",
                user_id=buyer.id,
                class_id=sc.id,
                status=OrderStatus.PENDING,
                total_price=300,
                is_paid=False,
            ),
            Order(
                serial_number="ORD-S-3",
                user_id=buyer.id,
                class_id=sc.id,
                status=OrderStatus.CANCELLED,
                total_price=999,
            ),
        ]
    )
    await db_session.flush()

    summary = await shop_svc.order_summary(db_session, group_by="class")
    assert summary.total_amount == 500  # 已取消不計入
    assert summary.paid_amount == 200
    assert summary.unpaid_amount == 300
    assert len(summary.rows) == 1
    assert summary.rows[0].order_count == 2


async def test_order_summary_filters_product_and_grade_amount(
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session)
    product_a = await _make_product(db_session, price=100, stock=10)
    product_b = await _make_product(db_session, price=300, stock=10)
    buyer = await _make_user(db_session)
    order = Order(
        serial_number="ORD-FILTER-1",
        user_id=buyer.id,
        class_id=sc.id,
        status=OrderStatus.PENDING,
        total_price=400,
        is_paid=False,
    )
    db_session.add(order)
    await db_session.flush()
    db_session.add_all(
        [
            OrderItem(order_id=order.id, product_id=product_a.id, quantity=1, unit_price=100),
            OrderItem(order_id=order.id, product_id=product_b.id, quantity=1, unit_price=300),
        ]
    )
    await db_session.flush()

    summary = await shop_svc.order_summary(
        db_session,
        group_by="grade",
        product_id=product_a.id,
        grade=sc.grade,
    )

    assert summary.total_amount == 100
    assert summary.unpaid_amount == 100
    assert summary.rows[0].item_count == 1
    assert summary.rows[0].label == f"{sc.grade} 年級"


async def test_product_create_rejects_unknown_series(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="找不到所屬系列"):
        await shop_svc.create_product(
            db_session,
            data=ProductCreate(series_id=uuid.uuid4(), name="孤兒商品", price=10),
            created_by=uuid.uuid4(),
        )


async def test_draft_product_not_in_catalog_tree(db_session: AsyncSession) -> None:
    creator = await _make_actor(db_session)
    category = await shop_svc.create_category(
        db_session, data=ProductCategoryCreate(name="商品"), created_by=creator
    )
    series = await shop_svc.create_series(
        db_session, data=ProductSeriesCreate(category_id=category.id, name="文具系列")
    )
    await shop_svc.create_product(
        db_session,
        data=ProductCreate(series_id=series.id, name="未上架草稿", price=10),
        created_by=creator,
    )  # 維持 DRAFT
    tree = await shop_svc.build_catalog_tree(db_session)
    assert tree[0].series[0].products == []


async def test_class_order_list_defaults_to_all_class_orders(
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session)
    buyer = await _make_user(db_session)
    assisted_buyer = await _make_user(db_session)
    cadre = await _make_user(db_session)
    db_session.add_all(
        [
            Order(
                serial_number="ORD-CLASS-SELF",
                user_id=buyer.id,
                class_id=sc.id,
                assistance_scope="self",
                status=OrderStatus.PENDING,
                total_price=100,
            ),
            Order(
                serial_number="ORD-CLASS-ASSIST",
                user_id=assisted_buyer.id,
                class_id=sc.id,
                assistance_scope="class_assisted",
                assisted_by_id=cadre.id,
                status=OrderStatus.PENDING,
                total_price=100,
            ),
        ]
    )
    await db_session.flush()

    all_orders = await shop_svc.list_orders(db_session, class_ids=[sc.id])
    assisted_orders = await shop_svc.list_orders(
        db_session, class_ids=[sc.id], assistance_scope="class_assisted"
    )

    assert {order.serial_number for order in all_orders} == {
        "ORD-CLASS-SELF",
        "ORD-CLASS-ASSIST",
    }
    assert [order.serial_number for order in assisted_orders] == ["ORD-CLASS-ASSIST"]


async def test_class_order_summary_groups_products_and_payment(
    db_session: AsyncSession,
) -> None:
    sc = await _make_class(db_session)
    product_a = await _make_product(db_session, price=100, stock=10)
    product_b = await _make_product(db_session, price=250, stock=10)
    buyer = await _make_user(db_session)
    paid_order = Order(
        serial_number="ORD-CLASS-SUMMARY-1",
        user_id=buyer.id,
        class_id=sc.id,
        status=OrderStatus.PENDING,
        total_price=200,
        is_paid=True,
    )
    unpaid_order = Order(
        serial_number="ORD-CLASS-SUMMARY-2",
        user_id=buyer.id,
        class_id=sc.id,
        status=OrderStatus.PENDING,
        total_price=250,
        is_paid=False,
        assistance_scope="class_assisted",
    )
    db_session.add_all([paid_order, unpaid_order])
    await db_session.flush()
    db_session.add_all(
        [
            OrderItem(order_id=paid_order.id, product_id=product_a.id, quantity=2, unit_price=100),
            OrderItem(
                order_id=unpaid_order.id, product_id=product_b.id, quantity=1, unit_price=250
            ),
        ]
    )
    await db_session.flush()

    summary = await shop_svc.class_order_summary(db_session, class_ids=[sc.id])
    filtered = await shop_svc.class_order_summary(
        db_session, class_ids=[sc.id], product_id=product_a.id
    )

    assert summary.order_count == 2
    assert summary.item_count == 3
    assert summary.total_amount == 450
    assert summary.paid_amount == 200
    assert summary.unpaid_amount == 250
    assert summary.assisted_order_count == 1
    assert [(row.product_id, row.quantity) for row in summary.product_rows] == [
        (product_a.id, 2),
        (product_b.id, 1),
    ]
    assert filtered.order_count == 1
    assert filtered.total_amount == 200
