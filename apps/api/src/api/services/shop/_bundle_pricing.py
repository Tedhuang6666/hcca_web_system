"""套組優惠擇優：窮舉各套組成套件數，取整張訂單折抵最高的組合。"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from api.models.shop import ShopDiscountType, ShopPromotion

if TYPE_CHECKING:
    from api.services.shop._promotions import PromotionResult


def bundle_pricing_results(
    results: list[PromotionResult],
    subtotal: int,
    product_subtotals: dict[uuid.UUID, int] | None,
    product_quantities: dict[uuid.UUID, int] | None,
    categories: dict[uuid.UUID, uuid.UUID | None],
) -> list[PromotionResult]:
    # 避免與 _promotions 循環匯入。
    from api.services.shop._promotions import PromotionResult, _discount_amount

    bundles = [
        (result.promotion, result.discount_amount)
        for result in results
        if result.promotion is not None
        and result.promotion.discount_type == ShopDiscountType.BUNDLE_PRICE
        and result.discount_amount > 0
    ]
    if not bundles:
        return results

    # 套餐與相同件數原可享有的優惠擇優；已成套件數不再重複折抵。
    bundles.sort(
        key=lambda row: (
            -row[1],
            row[0].created_at,
            str(row[0].id),
        )
    )
    amounts = dict(product_subtotals or {})
    quantities = dict(product_quantities or {})
    others = [
        result
        for result in results
        if result.promotion is not None
        and result.promotion.discount_type != ShopDiscountType.BUNDLE_PRICE
    ]

    def remaining_results(
        amounts: dict[uuid.UUID, int], quantities: dict[uuid.UUID, int]
    ) -> list[PromotionResult]:
        remaining = sum(amounts.values())
        return [
            PromotionResult(
                result.promotion,
                min(
                    result.discount_amount,
                    _discount_amount(result.promotion, remaining, amounts, quantities, categories),
                ),
            )
            for result in others
            if result.promotion is not None
        ]

    def bundle_options(
        promotion: ShopPromotion,
        discount_amount: int,
        amounts: dict[uuid.UUID, int],
        quantities: dict[uuid.UUID, int],
    ) -> list[tuple[int, int, dict[uuid.UUID, int], dict[uuid.UUID, int]]]:
        """列出此套組可成套的件數；回傳（件數、折抵、剩餘金額、剩餘件數）。"""
        available = min(
            discount_amount,
            _discount_amount(promotion, sum(amounts.values()), amounts, quantities, categories),
        )
        products = promotion.target_products
        if available <= 0 or any(quantities.get(product.id, 0) <= 0 for product in products):
            return []
        max_count = min(quantities[product.id] for product in products)
        savings = max(0, sum(product.price for product in products) - promotion.discount_value)
        counts = range(max_count, 0, -1)
        if len(bundles) > 4:  # 組合過多時只比較「全部成套」與「不成套」，避免爆量運算。
            counts = range(max_count, max_count - 1, -1)
        options = []
        for count in counts:
            candidate_amounts = dict(amounts)
            candidate_quantities = dict(quantities)
            for product in products:
                quantity = quantities[product.id]
                leftover = quantity - count
                if leftover:
                    # 規格加價按件數分攤，已成套部分不再參與其他折扣。
                    candidate_amounts[product.id] = amounts[product.id] * leftover // quantity
                    candidate_quantities[product.id] = leftover
                else:
                    candidate_amounts.pop(product.id, None)
                    candidate_quantities.pop(product.id, None)
            options.append(
                (count, min(available, savings * count), candidate_amounts, candidate_quantities)
            )
        return options

    # 窮舉各套組的成套件數（含不成套），選整張訂單折抵最高者；同額時偏好較少套組，
    # 再依折抵、建立時間排序，使試算、下單與重算結果一致。
    baseline = remaining_results(amounts, quantities)
    best_total = min(subtotal, sum(row.discount_amount for row in baseline))
    best_selected: list[PromotionResult] = []
    best_remaining = baseline

    def search(
        index: int,
        amounts: dict[uuid.UUID, int],
        quantities: dict[uuid.UUID, int],
        chosen: list[PromotionResult],
    ) -> None:
        nonlocal best_total, best_selected, best_remaining
        if index == len(bundles):
            if not chosen:
                return
            rest = remaining_results(amounts, quantities)
            total = min(
                subtotal,
                sum(row.discount_amount for row in chosen)
                + sum(row.discount_amount for row in rest),
            )
            if total > best_total:
                best_total, best_selected, best_remaining = total, list(chosen), rest
            return
        promotion, discount_amount = bundles[index]
        for _count, amount, next_amounts, next_quantities in bundle_options(
            promotion, discount_amount, amounts, quantities
        ):
            search(
                index + 1,
                next_amounts,
                next_quantities,
                [*chosen, PromotionResult(promotion, amount)],
            )
        search(index + 1, amounts, quantities, chosen)

    search(0, amounts, quantities, [])
    return best_selected + best_remaining
