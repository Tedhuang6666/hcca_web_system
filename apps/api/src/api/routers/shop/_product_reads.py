from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from api.core.permission_codes import ALL_PERMISSION_CODES
from api.models.shop import (
    ProductStatus,
)
from api.routers.shop._common import (
    CurrentUser,
    DbDep,
    ManagerUser,
    OptionalUser,
    _class_purchase_buyer,
    _get_category_or_404,
    _get_product_or_404,
    _require_shop_manager,
)
from api.schemas.shop import (
    ProductCostOut,
    ProductOut,
    ProductPurchaseGroupOptionOut,
    ProductPurchasePermissionOut,
    ProductPurchaseRules,
    ShopPromotionOut,
)
from api.schemas.shop_profit import ProductProcurementUpdate, ShopProfitOut
from api.schemas.shop_targets import ShopTargetLookupRequest, ShopTargetOut
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.shop import _lookups as lookups_svc
from api.services.shop._profit import profit_analysis, update_procurement
from api.services.shop._purchase_rules import (
    product_purchase_restriction,
    purchase_restrictions,
)
from api.services.shop._targets import lookup_targets
from api.services.shop._testing import can_test_products
from api.services.shop._visibility import has_purchase_qualifications

router = APIRouter()


@router.get("/products", response_model=list[ProductOut], summary="列出商品")
async def list_products(
    session: DbDep,
    current_user: OptionalUser,
    category_id: uuid.UUID | None = Query(None),
    series_id: uuid.UUID | None = Query(None),
    status_filter: ProductStatus | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[ProductOut]:
    products = await shop_svc.list_products(
        session,
        category_id=category_id,
        series_id=series_id,
        status=status_filter,
        include_testing=await can_test_products(session, current_user),
        public_only=current_user is None,
        limit=limit,
        offset=offset,
    )
    restrictions = await purchase_restrictions(session, products, current_user)
    return [
        ProductOut.model_validate(product).model_copy(
            update={
                "purchase_allowed": restrictions[product.id] is None,
                "purchase_restriction": restrictions[product.id],
            }
        )
        for product in products
    ]


@router.get("/products/{product_id}", response_model=ProductOut, summary="取得商品詳情")
async def get_product(
    product_id: uuid.UUID,
    session: DbDep,
    current_user: OptionalUser,
    class_member_id: uuid.UUID | None = Query(None, description="班代代購的學生或名冊 ID"),
) -> ProductOut:
    buyer = await _class_purchase_buyer(session, current_user, class_member_id)
    product = await _get_product_or_404(product_id, session, current_user)
    if current_user is None and has_purchase_qualifications(product):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    product_out = ProductOut.model_validate(product)
    remaining = await shop_svc.remaining_product_quantity(
        session, product, buyer.id if buyer else None
    )
    restriction = await product_purchase_restriction(session, product, buyer)
    purchase_limit = product.max_quantity_per_user
    if class_member_id and (product.purchase_rules or {}).get("exclusive_group"):
        purchase_limit = 1
    return product_out.model_copy(
        update={
            "remaining_quantity_for_user": remaining,
            "max_quantity_per_user": purchase_limit,
            "purchase_allowed": restriction is None,
            "purchase_restriction": restriction,
        }
    )


@router.get(
    "/products/{product_id}/cost",
    response_model=ProductCostOut,
    summary="讀取內部商品成本（限商品管理者）",
)
async def get_product_cost(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser, response: Response
) -> ProductCostOut:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    response.headers["Cache-Control"] = "private, no-store"
    return ProductCostOut(unit_cost=product.unit_cost)


@router.put(
    "/products/{product_id}/procurement",
    response_model=ProductProcurementUpdate,
    summary="儲存完整內部採購設定（不調整可售庫存）",
)
async def save_product_procurement(
    product_id: uuid.UUID,
    data: ProductProcurementUpdate,
    session: DbDep,
    current_user: CurrentUser,
    response: Response,
) -> ProductProcurementUpdate:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    await update_procurement(session, product, data)
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.procurement_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": product.name},
        summary=f"更新商品「{product.name}」採購設定",
    )
    response.headers["Cache-Control"] = "private, no-store"
    return data


@router.get(
    "/profit",
    response_model=ShopProfitOut,
    summary="完整主題的整批採購盈利分析（全期、不含測試訂單）",
)
async def read_shop_profit(
    category_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    response: Response,
) -> ShopProfitOut:
    category = await _get_category_or_404(category_id, session)
    await _require_shop_manager(session, current_user)
    response.headers["Cache-Control"] = "private, no-store"
    return await profit_analysis(session, category)


@router.get(
    "/products/{product_id}/purchase-rules",
    response_model=ProductPurchaseRules,
    summary="讀取商品購買資格與名單（限商品管理者）",
)
async def get_product_purchase_rules(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> ProductPurchaseRules:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    return await lookups_svc.purchase_rules(session, product)


@router.get(
    "/purchase-group-options",
    response_model=list[ProductPurchaseGroupOptionOut],
    summary="同組限購可選商品（含主題下所有系列）",
)
async def list_purchase_group_options(
    category_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> list[ProductPurchaseGroupOptionOut]:
    category = await _get_category_or_404(category_id, session)
    await _require_shop_manager(session, current_user)
    return await lookups_svc.purchase_group_options(session, category.id)


@router.get(
    "/purchase-permissions",
    response_model=list[ProductPurchasePermissionOut],
    summary="商品購買資格可選權限（限商品管理者）",
)
async def list_purchase_permissions(session: DbDep, current_user: CurrentUser) -> list[dict]:
    await _require_shop_manager(session, current_user)
    return ALL_PERMISSION_CODES


@router.post(
    "/target-options",
    response_model=list[ShopTargetOut],
    summary="搜尋或核對商品與優惠名單（限商品管理者）",
)
async def lookup_shop_targets(
    payload: ShopTargetLookupRequest,
    session: DbDep,
    current_user: CurrentUser,
    response: Response,
) -> list[ShopTargetOut]:
    if payload.product_id is not None:
        await _get_product_or_404(payload.product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    response.headers["Cache-Control"] = "private, no-store"
    return await lookup_targets(
        session,
        keyword=payload.keyword,
        identifiers=payload.identifiers,
        product_id=payload.product_id,
    )


@router.get("/promotions", response_model=list[ShopPromotionOut], summary="列出校商優惠")
async def list_promotions(
    session: DbDep,
    current_user: ManagerUser,
    include_inactive: bool = Query(False),
) -> list[ShopPromotionOut]:
    promotions = await shop_svc.list_promotions(
        session,
        include_inactive=include_inactive,
        include_testing=await can_test_products(session, current_user),
    )
    return [shop_svc.serialize_promotion(promotion) for promotion in promotions]
