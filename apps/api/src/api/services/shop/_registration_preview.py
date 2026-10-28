"""依目前登記產生優惠預覽，集中訂單彙總與回應語意。"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.shop import ShopPromotion
from api.schemas.shop import ShopPromotionPreviewOut, ShopPromotionProductTargetOut
from api.services.shop import _orders, _promotions


@dataclass(frozen=True)
class RegistrationPromotionPreview:
    promotion: ShopPromotion | None
    output: ShopPromotionPreviewOut


async def preview_registration_promotion(
    session: AsyncSession,
    *,
    user_id: UUID,
    code: str | None,
    activity_id: UUID | None = None,
    category_id: UUID | None = None,
) -> RegistrationPromotionPreview:
    order = await _orders.get_current_registration(
        session,
        user_id,
        activity_id=activity_id,
        category_id=category_id,
        match_activity=True,
        editable_only=True,
    )
    subtotal = order.subtotal_price if order else 0
    result = await _promotions.preview_promotion(
        session,
        user_id=user_id,
        subtotal=subtotal,
        code=code,
        product_subtotals=_orders._promotion_product_subtotals(order.items) if order else {},
        product_quantities=_orders._promotion_product_quantities(order.items) if order else {},
        activity_id=activity_id,
        current_promotion_id=order.promotion_id if order else None,
        current_promotion_ids={row.promotion_id for row in order.applied_promotions}
        if order
        else set(),
    )
    promotion = result.promotion
    return RegistrationPromotionPreview(
        promotion=promotion,
        output=ShopPromotionPreviewOut.model_validate(
            {
                "eligible": result.eligible,
                "promotion_name": promotion.name if promotion else None,
                "promotion_code": promotion.code if promotion else None,
                "reason_code": result.reason_code,
                "reason": result.reason,
                "subtotal_price": subtotal,
                "discount_amount": result.discount_amount,
                "total_price": max(0, subtotal - result.discount_amount),
                "min_order_price": promotion.min_order_price if promotion else None,
                "shortfall": result.shortfall,
                "discount_type": promotion.discount_type if promotion else None,
                "discount_value": promotion.discount_value if promotion else None,
                "min_quantity": promotion.min_quantity if promotion else None,
                "quantity_shortfall": result.quantity_shortfall,
                "target_products": [
                    ShopPromotionProductTargetOut(id=product.id, name=product.name)
                    for product in (promotion.target_products or [])
                ]
                if promotion
                else [],
                "product_price_overrides": _promotions.serialize_product_price_overrides(promotion)
                if promotion
                else [],
            }
        ),
    )
