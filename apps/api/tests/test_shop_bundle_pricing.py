"""套組商品不得重複享有其他優惠；純計價回歸不需要資料庫。"""

from datetime import UTC, datetime
from itertools import permutations
from uuid import uuid4

import pytest

from api.models.shop import Product, ShopDiscountType, ShopPromotion, ShopPromotionProductPrice
from api.services.shop._promotions import PromotionResult, _allocate_promotions, _discount_amount


def _product(price):
    return Product(id=uuid4(), name=f"商品{price}", price=price)


def _promotion(name, kind, value, products=(), *, code=None, categories=None, prices=()):
    return ShopPromotion(
        id=uuid4(),
        name=name,
        code=code,
        created_at=datetime(2026, 11, 2, tzinfo=UTC),
        discount_type=kind,
        discount_value=value,
        min_order_price=0,
        min_quantity=1,
        gift_quantity=1,
        target_products=list(products),
        target_category_ids=categories,
        product_price_overrides=[
            ShopPromotionProductPrice(product_id=product.id, unit_price=price)
            for product, price in prices
        ],
    )


def _allocate(promotions, amounts, quantities, categories):
    subtotal = sum(amounts.values())
    return _allocate_promotions(
        [
            PromotionResult(
                promotion, _discount_amount(promotion, subtotal, amounts, quantities, categories)
            )
            for promotion in promotions
        ],
        subtotal,
        product_subtotals=amounts,
        product_quantities=quantities,
        product_category_ids=categories,
    )


@pytest.mark.parametrize("topic_scope", [False, True])
@pytest.mark.parametrize("coupon_index", [None, 0, 1, 2])
def test_nereid_set_costs_65_without_stacking(topic_scope, coupon_index):
    badge, charm = _product(30), _product(50)
    category_id = uuid4()
    scope = {"categories": [str(category_id)] if topic_scope else None}
    promotions = [
        _promotion(
            "紀念徽章&吊飾套組優惠", ShopDiscountType.BUNDLE_PRICE, 75, [badge, charm], **scope
        ),
        _promotion(
            "班聯會幹部優惠",
            ShopDiscountType.PRICE_OVERRIDE,
            0,
            [badge, charm],
            prices=[(badge, 25), (charm, 45)],
            **scope,
        ),
        _promotion(
            "班聯會幹部套組優惠", ShopDiscountType.BUNDLE_PRICE, 65, [badge, charm], **scope
        ),
    ]
    if coupon_index is not None:
        promotions[coupon_index].code = "NEREID"
    for ordered in permutations(promotions):
        allocations = _allocate(
            ordered,
            {badge.id: 30, charm.id: 50},
            {badge.id: 1, charm.id: 1},
            {badge.id: category_id, charm.id: category_id},
        )
        assert [(row.promotion.name, row.discount_amount) for row in allocations] == [
            ("班聯會幹部套組優惠", 15)
        ]
        assert 80 - sum(row.discount_amount for row in allocations) == 65


def test_unbundled_quantity_and_other_products_keep_their_discounts():
    badge, charm, other = _product(30), _product(50), _product(100)
    bundle = _promotion("套組", ShopDiscountType.BUNDLE_PRICE, 65, [badge, charm])
    staff = _promotion(
        "幹部單價",
        ShopDiscountType.PRICE_OVERRIDE,
        0,
        [badge, charm],
        prices=[(badge, 25), (charm, 45)],
    )
    unrelated = _promotion("其他商品折抵", ShopDiscountType.FIXED, 20, [other])
    amounts = {badge.id: 60, charm.id: 50, other.id: 100}
    quantities = {badge.id: 2, charm.id: 1, other.id: 1}
    allocations = _allocate([staff, unrelated, bundle], amounts, quantities, {})
    assert {row.promotion.name: row.discount_amount for row in allocations} == {
        "套組": 15,
        "幹部單價": 5,
        "其他商品折抵": 20,
    }
    assert amounts == {badge.id: 60, charm.id: 50, other.id: 100}
    assert quantities == {badge.id: 2, charm.id: 1, other.id: 1}


@pytest.mark.parametrize("count,surcharge", [(1, 0), (2, 0), (1, 10)])
def test_repeated_sets_and_variant_surcharges(count, surcharge):
    badge, charm = _product(30), _product(50)
    promotions = [
        _promotion("一般套組", ShopDiscountType.BUNDLE_PRICE, 75, [badge, charm]),
        _promotion("幹部套組", ShopDiscountType.BUNDLE_PRICE, 65, [badge, charm]),
        _promotion("全單折扣", ShopDiscountType.PERCENTAGE, 10),
    ]
    allocations = _allocate(
        promotions,
        {badge.id: 30 * count + surcharge, charm.id: 50 * count},
        {badge.id: count, charm.id: count},
        {},
    )
    assert [(row.promotion.name, row.discount_amount) for row in allocations] == [
        ("幹部套組", 15 * count)
    ]


def test_incomplete_set_still_gets_individual_staff_price():
    badge, charm = _product(30), _product(50)
    bundle = _promotion("套組", ShopDiscountType.BUNDLE_PRICE, 65, [badge, charm])
    staff = _promotion(
        "幹部單價",
        ShopDiscountType.PRICE_OVERRIDE,
        0,
        [badge, charm],
        prices=[(badge, 25), (charm, 45)],
    )
    allocations = _allocate([bundle, staff], {badge.id: 30}, {badge.id: 1}, {})
    assert [(row.promotion.name, row.discount_amount) for row in allocations] == [("幹部單價", 5)]


def test_overlapping_bundles_cannot_reuse_the_same_item():
    first, shared, last = _product(30), _product(50), _product(100)
    best = _promotion("較優惠套組", ShopDiscountType.BUNDLE_PRICE, 120, [shared, last])
    other = _promotion("另一套組", ShopDiscountType.BUNDLE_PRICE, 65, [first, shared])
    allocations = _allocate(
        [other, best],
        {first.id: 30, shared.id: 50, last.id: 100},
        {first.id: 1, shared.id: 1, last.id: 1},
        {},
    )
    assert [(row.promotion.name, row.discount_amount) for row in allocations] == [
        ("較優惠套組", 30)
    ]


def test_without_bundles_existing_stacking_and_subtotal_cap_are_preserved():
    product = _product(30)
    promotions = [_promotion(f"優惠{index}", ShopDiscountType.FIXED, 20) for index in range(3)]
    allocations = _allocate(promotions, {product.id: 30}, {product.id: 1}, {})
    assert [row.discount_amount for row in allocations] == [20, 10]


def test_disjoint_bundles_can_both_apply():
    products = [_product(price) for price in (30, 50, 100, 200)]
    promotions = [
        _promotion("紀念品套組", ShopDiscountType.BUNDLE_PRICE, 65, products[:2]),
        _promotion("另一套組", ShopDiscountType.BUNDLE_PRICE, 270, products[2:]),
    ]
    allocations = _allocate(
        promotions,
        {row.id: row.price for row in products},
        {row.id: 1 for row in products},
        {},
    )
    assert {row.promotion.name: row.discount_amount for row in allocations} == {
        "紀念品套組": 15,
        "另一套組": 30,
    }


def test_topic_discount_only_uses_unbundled_merchandise():
    badge, charm, other = _product(30), _product(50), _product(200)
    category_id = uuid4()
    promotions = [
        _promotion("套組", ShopDiscountType.BUNDLE_PRICE, 65, [badge, charm]),
        _promotion("主題折扣", ShopDiscountType.PERCENTAGE, 10, categories=[str(category_id)]),
    ]
    products = [badge, charm, other]
    allocations = _allocate(
        promotions,
        {row.id: row.price for row in products},
        {row.id: 1 for row in products},
        {row.id: category_id for row in products},
    )
    assert {row.promotion.name: row.discount_amount for row in allocations} == {
        "套組": 15,
        "主題折扣": 20,
    }


@pytest.mark.parametrize("topic_scope", [False, True])
def test_activity_free_coupon_covers_all_quantities_and_surcharges_before_bundles(topic_scope):
    badge, charm = _product(30), _product(50)
    category_id = uuid4()
    free = _promotion(
        "活動免費券",
        ShopDiscountType.PERCENTAGE,
        100,
        categories=[str(category_id)] if topic_scope else None,
    )
    bundle = _promotion("套組", ShopDiscountType.BUNDLE_PRICE, 65, [badge, charm])
    coupon = _promotion("優惠碼", ShopDiscountType.FIXED, 5, code="SAVE5")
    for ordered in permutations([free, bundle, coupon]):
        allocations = _allocate(
            ordered,
            {badge.id: 80, charm.id: 150},
            {badge.id: 2, charm.id: 3},
            {badge.id: category_id, charm.id: category_id},
        )
        assert [(row.promotion.name, row.discount_amount) for row in allocations] == [
            ("活動免費券", 230)
        ]


def test_free_scope_cannot_discount_another_topic_twice_or_disable_its_bundle():
    products = [_product(price) for price in (30, 50, 100, 200)]
    free_topic, paid_topic = uuid4(), uuid4()
    promotions = [
        _promotion("免費活動套組", ShopDiscountType.BUNDLE_PRICE, 65, products[:2]),
        _promotion("付費活動套組", ShopDiscountType.BUNDLE_PRICE, 270, products[2:]),
        _promotion(
            "免費活動優惠碼",
            ShopDiscountType.FIXED,
            50,
            code="FREE50",
            categories=[str(free_topic)],
        ),
        _promotion("活動免費券", ShopDiscountType.PERCENTAGE, 100, categories=[str(free_topic)]),
        _promotion("重複免費券", ShopDiscountType.PERCENTAGE, 100, categories=[str(free_topic)]),
    ]
    allocations = _allocate(
        promotions,
        {row.id: row.price for row in products},
        {row.id: 1 for row in products},
        {row.id: free_topic if index < 2 else paid_topic for index, row in enumerate(products)},
    )
    assert {row.promotion.name: row.discount_amount for row in allocations} == {
        "活動免費券": 80,
        "付費活動套組": 30,
    }
