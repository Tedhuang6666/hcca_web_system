"""商品訂購系統 Router - 分類 / 變體 / 登記 / 訂單 / 統計 / 報表"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable
from datetime import date, datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from api.core.clock import local_today
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_any, require_permission
from api.models.school_class import SchoolClass
from api.models.shop import (
    Order,
    OrderStatus,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
    ShopPromotion,
)
from api.models.user import User
from api.routers._common import or_404
from api.schemas.activity import ActivityOut
from api.schemas.school_class import ClassMemberOut
from api.schemas.shop import (
    AdminAssistedOrderCreate,
    CatalogCategoryOut,
    ChangedOrderReceiptCreate,
    ClassCollectionUpdate,
    ClassOrderCreate,
    ClassOrderUpsert,
    ClassPaymentOut,
    ClassPaymentReportItemOut,
    ClassPaymentUpdate,
    ClassReceiptBatchCreate,
    CloseStatusItem,
    CloseStatusOut,
    CurrentRegistrationUpdate,
    ImageUploadOut,
    OrderCancelRequest,
    OrderItemQuantityUpdate,
    OrderListItem,
    OrderOut,
    OrderPaymentUpdate,
    OrderQuantityRow,
    OrderSummaryOut,
    ProductCategoryCreate,
    ProductCategoryOut,
    ProductCategoryUpdate,
    ProductCreate,
    ProductOut,
    ProductSeriesCreate,
    ProductSeriesOut,
    ProductSeriesUpdate,
    ProductUpdate,
    ProductVariantGroupCreate,
    ProductVariantGroupOut,
    ProductVariantGroupUpdate,
    ProductVariantOptionCreate,
    ProductVariantOptionOut,
    ProductVariantOptionUpdate,
    ShopActivityDeadlineUpdate,
    ShopActivityOrderClosureUpdate,
    ShopClassSummaryOut,
    ShopDelegatedOrderOut,
    ShopDelegationAccess,
    ShopDelegationCodeCreate,
    ShopDelegationCodeOut,
    ShopDelegationContextOut,
    ShopDelegationCreate,
    ShopDelegationOut,
    ShopDelegationPromotionUpdate,
    ShopDelegationRegistrationUpdate,
    ShopDelegationUpdate,
    ShopOrderCloseCreate,
    ShopOrderCloseOut,
    ShopOrdersClearOut,
    ShopPromotionCreate,
    ShopPromotionOut,
    ShopPromotionPreviewOut,
    ShopPromotionPreviewRequest,
    ShopPromotionPublicOut,
    ShopPromotionUpdate,
)
from api.schemas.shop_analytics import ShopSalesAnalyticsOut, ShopSalesReportCreate
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.realtime_events import broadcast_order_updated
from api.services.shop import _class_settlement as class_settlement_svc
from api.services.shop import _delegation as delegation_svc
from api.services.shop import _delegation_codes as delegation_code_svc
from api.services.shop import _orders as orders_svc
from api.services.shop import _supplements as supplement_svc
from api.services.shop._analytics import sales_analytics
from api.services.shop._analytics_report import create_sales_report
from api.services.shop._deadlines import set_activity_order_closure, set_activity_order_deadline
from api.services.shop._testing import can_test_products, start_product_testing
from api.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shop", tags=["商品訂購"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.SHOP_MANAGE))]

_ADMIN_VIEW_CODES = {
    PermissionCode.SHOP_MANAGE,
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.SHOP_VIEW_ALL,
    PermissionCode.FINANCE_VIEW,
    PermissionCode.ADMIN_ALL,
}
_PAYMENT_WRITE_CODES = {
    PermissionCode.SHOP_MANAGE,
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.ADMIN_ALL,
}


# ── 輔助 ─────────────────────────────────────────────────────────────────────


async def _get_category_or_404(category_id: uuid.UUID, session: AsyncSession) -> ProductCategory:
    obj = await shop_svc.get_category(session, category_id)
    return or_404(obj, "找不到此主題")


async def _get_series_or_404(series_id: uuid.UUID, session: AsyncSession) -> ProductSeries:
    obj = await shop_svc.get_series(session, series_id)
    return or_404(obj, "找不到此系列")


async def _get_product_or_404(
    product_id: uuid.UUID, session: AsyncSession, current_user: User | None
) -> Product:
    p = await shop_svc.get_product(session, product_id)
    if (
        p is not None
        and p.status == ProductStatus.TESTING
        and not await can_test_products(session, current_user)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    return or_404(p, "找不到此商品")


async def _get_variant_group_or_404(
    group_id: uuid.UUID, session: AsyncSession
) -> ProductVariantGroup:
    g = await shop_svc.get_variant_group(session, group_id)
    return or_404(g, "找不到此變體群組")


async def _get_variant_option_or_404(
    option_id: uuid.UUID, session: AsyncSession
) -> ProductVariantOption:
    o = await shop_svc.get_variant_option(session, option_id)
    return or_404(o, "找不到此變體選項")


async def _get_order_or_404(
    order_id: uuid.UUID, session: AsyncSession, current_user: User
) -> Order:
    o = await shop_svc.get_order(session, order_id)
    if (
        o is not None
        and o.test_product_id is not None
        and not await can_test_products(session, current_user)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return or_404(o, "找不到此訂單")


async def _require_promotion_visible(
    session: AsyncSession, user: User, promotion: ShopPromotion
) -> None:
    if any(
        product.status == ProductStatus.TESTING for product in promotion.target_products
    ) and not await can_test_products(session, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此優惠")


async def _get_promotion_or_404(
    promotion_id: uuid.UUID, session: AsyncSession, current_user: User
) -> ShopPromotion:
    promotion = await shop_svc.get_promotion(session, promotion_id)
    promotion = or_404(promotion, "找不到此優惠")
    await _require_promotion_visible(session, current_user, promotion)
    return promotion


async def _broadcast_shop_order(order: Order) -> None:
    await broadcast_order_updated(
        domain="shop",
        order_id=order.id,
        user_id=order.user_id,
        status=order.status.value,
        is_paid=order.is_paid,
    )


async def _queue_order_confirmation(session: AsyncSession, buyer: User, order: Order) -> None:
    if not buyer.email:
        return
    order_data = shop_svc.serialize_order(order)
    from api.services.outbox import emit as outbox_emit

    await outbox_emit(
        session,
        event_type="shop.order_confirmed",
        payload={
            "order_id": str(order_data.id),
            "serial_number": order_data.serial_number,
            "buyer_id": str(buyer.id),
            "buyer_email": buyer.email,
            "buyer_name": buyer.display_name or "",
            "subtotal_price": order_data.subtotal_price,
            "discount_amount": order_data.discount_amount,
            "promotion_code": order_data.promotion_code,
            "total_price": order_data.total_price,
            "items": [
                {
                    "product_name": item.product_name or "商品",
                    "unit_price": item.unit_price,
                    "quantity": item.quantity,
                    "subtotal": item.subtotal,
                    "selected_options": [
                        option.model_dump(mode="json") for option in item.selected_options
                    ],
                }
                for item in order_data.items
            ],
        },
    )


async def _has_shop_manage(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    codes = await get_user_permission_codes(session, user.id)
    return str(PermissionCode.SHOP_MANAGE) in codes or str(PermissionCode.ADMIN_ALL) in codes


async def _require_shop_manager(
    session: AsyncSession, user: User, activity_id: uuid.UUID | None
) -> None:
    if await _has_shop_manage(session, user):
        return
    if await activity_svc.can_manage_activity_resource(session, user, activity_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：shop:manage")


def _category_activity(category: ProductCategory | None) -> uuid.UUID | None:
    return category.activity_id if category else None


def _product_activity(product: Product) -> uuid.UUID | None:
    category = getattr(product, "category", None)
    if category is not None:
        return _category_activity(category)
    series = getattr(product, "series", None)
    return _category_activity(getattr(series, "category", None) if series else None)


# ── 圖片上傳 ──────────────────────────────────────────────────────────────────


@router.post(
    "/images",
    response_model=ImageUploadOut,
    summary="上傳商品 / 分類圖片",
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def upload_image(_: CurrentUser, file: UploadFile = File(...)) -> ImageUploadOut:
    storage = get_storage()
    try:
        stored = await storage.save(file, prefix="shop")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return ImageUploadOut(url=stored.url)


# ── 主題（ProductCategory）──────────────────────────────────────────────────


@router.get("/categories", response_model=list[ProductCategoryOut], summary="列出主題")
async def list_categories(
    session: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    include_inactive: bool = Query(True),
) -> list[ProductCategory]:
    return await shop_svc.list_categories(
        session, activity_id=activity_id, include_inactive=include_inactive
    )


@router.get("/activities", response_model=list[ActivityOut], summary="列出可供商品分類使用的活動")
async def list_shop_activities(session: DbDep, current_user: CurrentUser) -> list[ActivityOut]:
    permission_codes = await get_user_permission_codes(session, current_user.id)
    if any(str(code) in permission_codes for code in _ADMIN_VIEW_CODES):
        activities = await activity_svc.list_activities(session, active_only=True)
    else:
        activities = await activity_svc.list_user_convener_activities(
            session, current_user.id, active_only=True
        )
    return [ActivityOut.model_validate(activity) for activity in activities]


@router.patch(
    "/activities/{activity_id}/order-deadline",
    response_model=ActivityOut,
    summary="設定整個活動的商品結單時間",
)
async def update_shop_activity_deadline(
    activity_id: uuid.UUID,
    payload: ShopActivityDeadlineUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ActivityOut:
    await _require_shop_manager(session, current_user, activity_id)
    activity = await set_activity_order_deadline(
        session, activity_id, closes_at=payload.order_closes_at
    )
    return ActivityOut.model_validate(or_404(activity, "找不到此活動"))


@router.patch(
    "/activities/{activity_id}/order-closure",
    response_model=ActivityOut,
    summary="結單或重新開放活動訂購；保留訂單與收款",
)
async def update_shop_activity_order_closure(
    activity_id: uuid.UUID,
    payload: ShopActivityOrderClosureUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ActivityOut:
    await _require_shop_manager(session, current_user, activity_id)
    activity = or_404(
        await set_activity_order_closure(session, activity_id, is_closed=payload.is_closed),
        "找不到此活動",
    )
    await audit_svc.record(
        session,
        entity_type="activity",
        entity_id=str(activity_id),
        action="shop.activity_order_close" if payload.is_closed else "shop.activity_order_reopen",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "order_closed_at": activity.order_closed_at.isoformat()
            if activity.order_closed_at
            else None
        },
        summary=f"活動「{activity.name}」{'結單' if payload.is_closed else '重新開放訂購'}",
    )
    return ActivityOut.model_validate(activity)


@router.post(
    "/categories",
    response_model=ProductCategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增主題",
)
async def create_category(
    payload: ProductCategoryCreate, session: DbDep, current_user: CurrentUser
) -> ProductCategory:
    await _require_shop_manager(session, current_user, payload.activity_id)
    return await shop_svc.create_category(session, data=payload, created_by=current_user.id)


@router.patch("/categories/{category_id}", response_model=ProductCategoryOut, summary="更新主題")
async def update_category(
    category_id: uuid.UUID,
    payload: ProductCategoryUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductCategory:
    category = await _get_category_or_404(category_id, session)
    await _require_shop_manager(session, current_user, category.activity_id)
    if "activity_id" in payload.model_fields_set:
        await _require_shop_manager(session, current_user, payload.activity_id)
    return await shop_svc.update_category(session, category, data=payload)


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除主題",
)
async def delete_category(
    category_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> None:
    category = await _get_category_or_404(category_id, session)
    await _require_shop_manager(session, current_user, category.activity_id)
    try:
        await shop_svc.delete_category(session, category)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


# ── 系列（ProductSeries）─────────────────────────────────────────────────────


@router.get("/series", response_model=list[ProductSeriesOut], summary="列出系列")
async def list_series(
    session: DbDep,
    _: CurrentUser,
    category_id: uuid.UUID | None = Query(None),
    include_inactive: bool = Query(True),
) -> list[ProductSeries]:
    return await shop_svc.list_series(
        session, category_id=category_id, include_inactive=include_inactive
    )


@router.post(
    "/series",
    response_model=ProductSeriesOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增系列",
)
async def create_series(
    payload: ProductSeriesCreate, session: DbDep, current_user: CurrentUser
) -> ProductSeries:
    category = await _get_category_or_404(payload.category_id, session)
    await _require_shop_manager(session, current_user, category.activity_id)
    try:
        return await shop_svc.create_series(session, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


@router.patch("/series/{series_id}", response_model=ProductSeriesOut, summary="更新系列")
async def update_series(
    series_id: uuid.UUID,
    payload: ProductSeriesUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductSeries:
    series = await _get_series_or_404(series_id, session)
    category = await _get_category_or_404(series.category_id, session)
    await _require_shop_manager(session, current_user, category.activity_id)
    return await shop_svc.update_series(session, series, data=payload)


@router.delete(
    "/series/{series_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除系列",
)
async def delete_series(series_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    series = await _get_series_or_404(series_id, session)
    category = await _get_category_or_404(series.category_id, session)
    await _require_shop_manager(session, current_user, category.activity_id)
    try:
        await shop_svc.delete_series(session, series)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


# ── 購買頁瀏覽樹 ──────────────────────────────────────────────────────────────


@router.get("/catalog", response_model=list[CatalogCategoryOut], summary="購買頁瀏覽樹")
async def get_catalog(
    session: DbDep,
    current_user: OptionalUser,
    activity_id: uuid.UUID | None = Query(None),
    include_closed: bool = Query(False, description="包含已結單活動，供登入後查詢與收款"),
    direct_path: list[str] = Query(
        default=[], description="只解析公開商品連結對應的分類與商品，可顯示已結單商品"
    ),
) -> list[CatalogCategoryOut]:
    if include_closed and current_user is None and not direct_path:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請先登入")
    if direct_path and len(direct_path) not in (1, 2):
        return []
    catalog = await shop_svc.build_catalog_tree(
        session,
        activity_id=activity_id,
        include_testing=await can_test_products(session, current_user),
        include_closed=include_closed or bool(direct_path),
    )
    return (
        shop_svc.filter_catalog_to_direct_product(catalog, direct_path) if direct_path else catalog
    )


# ── 商品 ──────────────────────────────────────────────────────────────────────


@router.get("/products", response_model=list[ProductOut], summary="列出商品")
async def list_products(
    session: DbDep,
    current_user: OptionalUser,
    activity_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    series_id: uuid.UUID | None = Query(None),
    status_filter: ProductStatus | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Product]:
    return await shop_svc.list_products(
        session,
        activity_id=activity_id,
        category_id=category_id,
        series_id=series_id,
        status=status_filter,
        include_testing=await can_test_products(session, current_user),
        limit=limit,
        offset=offset,
    )


@router.get("/products/{product_id}", response_model=ProductOut, summary="取得商品詳情")
async def get_product(
    product_id: uuid.UUID, session: DbDep, current_user: OptionalUser
) -> ProductOut:
    product = await _get_product_or_404(product_id, session, current_user)
    product_out = ProductOut.model_validate(product)
    remaining = await shop_svc.remaining_product_quantity(
        session, product, current_user.id if current_user else None
    )
    return product_out.model_copy(update={"remaining_quantity_for_user": remaining})


# ── 優惠管理 ──────────────────────────────────────────────────────────────────


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


@router.post(
    "/orders/classes/receipts.pdf",
    summary="批次下載班級收款簽收單",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_class_receipts(
    payload: ClassReceiptBatchCreate,
    session: DbDep,
) -> Response:
    school_classes: list[SchoolClass] | None = None
    if payload.class_ids is not None:
        school_classes = list(
            (
                await session.scalars(
                    select(SchoolClass)
                    .where(SchoolClass.id.in_(payload.class_ids))
                    .order_by(SchoolClass.class_code, SchoolClass.id)
                )
            ).all()
        )
        if len(school_classes) != len(set(payload.class_ids)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到指定班級")
    try:
        pdf = await shop_svc.export_class_receipts_pdf(
            session,
            school_classes,
            activity_id=payload.activity_id,
            unpaid_only=payload.unpaid_only and school_classes is None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename = "班聯收款簽收單-班級.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/orders/receipts/changed.pdf",
    summary="批次列印上次列印後有變更的班級與個人訂單收據",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_changed_order_receipts(
    payload: ChangedOrderReceiptCreate,
    session: DbDep,
) -> Response:
    try:
        pdf = await shop_svc.export_changed_order_receipts_pdf(
            session, activity_id=payload.activity_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote('班聯收款簽收單-增量.pdf', safe='')}"
            ),
            "Cache-Control": "no-store",
        },
    )


@router.get(
    "/promotions/available",
    response_model=list[ShopPromotionPublicOut],
    summary="列出目前帳號可使用的優惠",
)
async def list_available_promotions(
    session: DbDep,
    current_user: OptionalUser,
) -> list[ShopPromotionPublicOut]:
    promotions = await shop_svc.list_public_promotions(
        session,
        user_id=current_user.id if current_user else None,
        include_testing=await can_test_products(session, current_user),
    )
    return [shop_svc.serialize_public_promotion(promotion) for promotion in promotions]


@router.post(
    "/promotions",
    response_model=ShopPromotionOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立校商優惠",
)
async def create_promotion(
    payload: ShopPromotionCreate, session: DbDep, current_user: ManagerUser
) -> ShopPromotionOut:
    try:
        promotion = await shop_svc.create_promotion(
            session, data=payload, created_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _require_promotion_visible(session, current_user, promotion)
    return shop_svc.serialize_promotion(promotion)


@router.patch("/promotions/{promotion_id}", response_model=ShopPromotionOut, summary="更新校商優惠")
async def update_promotion(
    promotion_id: uuid.UUID,
    payload: ShopPromotionUpdate,
    session: DbDep,
    current_user: ManagerUser,
) -> ShopPromotionOut:
    promotion = await _get_promotion_or_404(promotion_id, session, current_user)
    try:
        updated = await shop_svc.update_promotion(session, promotion, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await _require_promotion_visible(session, current_user, updated)
    return shop_svc.serialize_promotion(updated)


@router.delete(
    "/promotions/{promotion_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除校商優惠",
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "需要商品管理權限"},
        status.HTTP_404_NOT_FOUND: {"description": "找不到此優惠"},
        status.HTTP_409_CONFLICT: {"description": "優惠已有訂單紀錄，無法刪除"},
    },
)
async def delete_promotion(
    promotion_id: uuid.UUID, session: DbDep, current_user: ManagerUser
) -> None:
    promotion = await _get_promotion_or_404(promotion_id, session, current_user)
    try:
        await shop_svc.delete_promotion(session, promotion)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post(
    "/products",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增商品（可附變體）",
)
async def create_product(
    payload: ProductCreate, session: DbDep, current_user: CurrentUser
) -> Product:
    series = await _get_series_or_404(payload.series_id, session) if payload.series_id else None
    category_id = payload.category_id or (series.category_id if series else None)
    if category_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="請選擇所屬主題",
        )
    category = await _get_category_or_404(category_id, session)
    if series and series.category_id != category.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="所選系列不屬於此主題",
        )
    await _require_shop_manager(session, current_user, category.activity_id)
    try:
        product = await shop_svc.create_product(session, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": product.name, "price": product.price},
        summary=f"建立商品「{product.name}」",
    )
    return product


@router.patch("/products/{product_id}", response_model=ProductOut, summary="更新商品")
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> Product:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    target_category_id = payload.category_id
    if payload.series_id:
        target_series = await _get_series_or_404(payload.series_id, session)
        target_category_id = payload.category_id or target_series.category_id
    if target_category_id is None:
        target_category_id = product.category_id
    if target_category_id is None and product.series is not None:
        target_category_id = product.series.category_id
    if target_category_id is not None:
        target_category = await _get_category_or_404(target_category_id, session)
        await _require_shop_manager(session, current_user, target_category.activity_id)
    try:
        product = await shop_svc.update_product(session, product, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": product.name, "price": product.price},
        summary=f"更新商品「{product.name}」",
    )
    return product


@router.post("/products/{product_id}/test", response_model=ProductOut, summary="開始測試商品")
async def test_product(product_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> Product:
    if not await can_test_products(session, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：shop:test")
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    try:
        product = await start_product_testing(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_test",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"開始測試商品「{product.name}」",
    )
    return product


@router.post("/products/{product_id}/activate", response_model=ProductOut, summary="上架商品")
async def activate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    try:
        product = await shop_svc.activate_product(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_activate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"上架商品「{product.name}」",
    )
    return product


@router.post("/products/{product_id}/deactivate", response_model=ProductOut, summary="下架商品")
async def deactivate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    try:
        product = await shop_svc.deactivate_product(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"下架商品「{product.name}」",
    )
    return product


@router.delete(
    "/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除商品",
)
async def delete_product(product_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    product = await _get_product_or_404(product_id, session, current_user)
    product_name = product.name
    await _require_shop_manager(session, current_user, _product_activity(product))
    try:
        await shop_svc.delete_product(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": product_name},
        summary=f"刪除商品「{product_name}」",
    )


# ── 變體群組 / 選項 ───────────────────────────────────────────────────────────


@router.post(
    "/products/{product_id}/variant-groups",
    response_model=ProductVariantGroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增變體群組",
)
async def add_variant_group(
    product_id: uuid.UUID,
    payload: ProductVariantGroupCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantGroup:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    return await shop_svc.add_variant_group(session, product, data=payload)


@router.patch(
    "/variant-groups/{group_id}",
    response_model=ProductVariantGroupOut,
    summary="更新變體群組",
)
async def update_variant_group(
    group_id: uuid.UUID,
    payload: ProductVariantGroupUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantGroup:
    group = await _get_variant_group_or_404(group_id, session)
    product = await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    return await shop_svc.update_variant_group(session, group, data=payload)


@router.delete(
    "/variant-groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除變體群組",
)
async def delete_variant_group(
    group_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> None:
    group = await _get_variant_group_or_404(group_id, session)
    product = await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    await shop_svc.delete_variant_group(session, group)


@router.post(
    "/variant-groups/{group_id}/options",
    response_model=ProductVariantOptionOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增變體選項",
)
async def add_variant_option(
    group_id: uuid.UUID,
    payload: ProductVariantOptionCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantOption:
    group = await _get_variant_group_or_404(group_id, session)
    product = await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    return await shop_svc.add_variant_option(session, group, data=payload)


@router.patch(
    "/variant-options/{option_id}",
    response_model=ProductVariantOptionOut,
    summary="更新變體選項",
)
async def update_variant_option(
    option_id: uuid.UUID,
    payload: ProductVariantOptionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantOption:
    option = await _get_variant_option_or_404(option_id, session)
    group = await _get_variant_group_or_404(option.group_id, session)
    product = await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    return await shop_svc.update_variant_option(session, option, data=payload)


@router.delete(
    "/variant-options/{option_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除變體選項",
)
async def delete_variant_option(
    option_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> None:
    option = await _get_variant_option_or_404(option_id, session)
    group = await _get_variant_group_or_404(option.group_id, session)
    product = await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user, _product_activity(product))
    await shop_svc.delete_variant_option(session, option)


# ── 商品登記 ──────────────────────────────────────────────────────────────────


@router.get(
    "/registrations",
    response_model=list[OrderOut],
    summary="取得各活動目前商品登記",
)
async def list_current_registrations(session: DbDep, current_user: CurrentUser) -> list[OrderOut]:
    orders = await shop_svc.get_current_registrations(
        session, current_user.id, include_testing=await can_test_products(session, current_user)
    )
    return [shop_svc.serialize_order(order) for order in orders]


@router.get(
    "/registrations/current",
    response_model=OrderOut | None,
    summary="取得目前商品登記",
)
async def get_current_registration(session: DbDep, current_user: CurrentUser) -> OrderOut | None:
    order = await shop_svc.get_current_registration(session, current_user.id)
    return shop_svc.serialize_order(order) if order else None


@router.post(
    "/registrations/current/promotion/preview",
    response_model=ShopPromotionPreviewOut,
    summary="預覽目前商品登記的優惠",
)
async def preview_current_registration_promotion(
    payload: ShopPromotionPreviewRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopPromotionPreviewOut:
    result = await shop_svc.preview_registration_promotion(
        session,
        user_id=current_user.id,
        code=payload.code,
        activity_id=payload.activity_id,
        category_id=payload.category_id,
    )
    if result.promotion is not None:
        await _require_promotion_visible(session, current_user, result.promotion)
    return result.output


@router.put(
    "/registrations/current/promotion",
    response_model=OrderOut,
    summary="套用目前商品登記的優惠",
)
async def apply_current_registration_promotion(
    payload: ShopPromotionPreviewRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    try:
        order = await shop_svc.apply_registration_promotion(
            session,
            current_user,
            code=payload.code,
            activity_id=payload.activity_id,
            category_id=payload.category_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return shop_svc.serialize_order(order)


@router.put(
    "/registrations/current/products/{product_id}",
    response_model=OrderOut | None,
    summary="立即更新商品登記",
)
async def update_current_registration_product(
    product_id: uuid.UUID,
    payload: CurrentRegistrationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut | None:
    try:
        order = await shop_svc.set_current_registration_product(
            session,
            current_user,
            product_id,
            data=payload,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except StaleDataError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="庫存已更新，請重新載入"
        ) from e
    except shop_svc.PurchaseLimitError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e

    if order is None:
        return None
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.registration_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "product_id": str(product_id)},
        summary=f"更新商品登記「{order.serial_number}」",
    )
    full = await shop_svc.get_order(session, order.id)
    updated = full or order
    await _broadcast_shop_order(updated)
    return shop_svc.serialize_order(updated)


# ── 訂單 ──────────────────────────────────────────────────────────────────────


@router.get("/orders", response_model=list[OrderListItem], summary="列出訂單")
async def list_orders(
    session: DbDep,
    current_user: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    my_only: bool = Query(True, description="僅顯示我的訂單"),
    grade: int | None = Query(None, description="按年級篩選（需 SHOP_VIEW_ALL 權限）"),
    class_id: uuid.UUID | None = Query(None, description="按班級篩選（需 SHOP_VIEW_ALL 權限）"),
    product_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    search: str | None = Query(None, max_length=100),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    is_admin = current_user.is_superuser
    if not is_admin:
        codes = await get_user_permission_codes(session, current_user.id)
        is_admin = bool(_ADMIN_VIEW_CODES & set(codes))
    if not my_only and not is_admin:
        can_view_activity = bool(
            activity_id
            and await activity_svc.can_manage_activity_resource(session, current_user, activity_id)
        )
        if not can_view_activity:
            my_only = True

    # grade/class_id 篩選只對管理員有效
    filter_grade = grade if is_admin else None
    filter_class_ids: list[uuid.UUID] | None = [class_id] if (is_admin and class_id) else None

    orders = await shop_svc.list_orders(
        session,
        user_id=current_user.id if my_only else None,
        activity_id=activity_id,
        status=status_filter,
        class_ids=filter_class_ids,
        grade=filter_grade,
        product_id=product_id if is_admin else None,
        category_id=category_id if is_admin else None,
        is_paid=is_paid if is_admin else None,
        date_from=date_from if is_admin else None,
        date_to=date_to if is_admin else None,
        search=search if is_admin else None,
        limit=limit,
        offset=offset,
        include_testing=await can_test_products(session, current_user),
    )
    return [shop_svc.serialize_order_list_item(o) for o in orders]


@router.get(
    "/orders/delegated",
    response_model=list[ShopDelegatedOrderOut],
    summary="列出本人代訂的學生訂單",
)
async def list_delegated_orders(
    session: DbDep,
    current_user: CurrentUser,
    order_id: uuid.UUID | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[ShopDelegatedOrderOut]:
    return await delegation_svc.list_delegated_orders(
        session,
        current_user,
        order_id=order_id,
        limit=limit,
        offset=offset,
    )


async def _class_order_scope_ids(session: AsyncSession, user: User) -> list[uuid.UUID]:
    class_ids = await class_svc.get_cadre_class_ids(session, user.id)
    if user.is_superuser:
        current_class = await class_svc.resolve_user_class(session, user)
        if current_class is not None:
            class_ids.add(current_class.id)
    return list(class_ids)


async def _get_class_member_target(
    session: AsyncSession,
    current_user: User,
    member_user_id: uuid.UUID,
) -> tuple[User, SchoolClass, list[uuid.UUID]]:
    target = await session.get(User, member_user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此學生")
    target_class = await class_svc.resolve_user_class(session, target)
    if target_class is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="此學生目前沒有可管理的班級"
        )
    class_ids = set(await _class_order_scope_ids(session, current_user))
    if current_user.is_superuser:
        class_ids.add(target_class.id)
    elif target_class.id not in class_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="無權管理此學生的商品登記"
        )
    return target, target_class, list(class_ids)


@router.get(
    "/orders/class",
    response_model=list[OrderListItem],
    summary="班級幹部檢視本班訂單",
)
async def list_class_orders(
    session: DbDep,
    current_user: CurrentUser,
    is_class_collected: bool | None = Query(None, description="篩選班代個人收款紀錄"),
    assisted_only: bool = Query(False, description="僅顯示班級幹部協助建立的訂單"),
    activity_id: uuid.UUID | None = Query(None, description="篩選活動"),
    category_id: uuid.UUID | None = Query(None, description="篩選未綁活動的商品分類"),
    general_only: bool = Query(False, description="僅顯示未綁活動的訂單"),
    product_id: uuid.UUID | None = Query(None, description="篩選商品"),
    member_user_id: uuid.UUID | None = Query(None, description="篩選特定學生"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    class_ids = await _class_order_scope_ids(session, current_user)
    orders = await shop_svc.list_orders(
        session,
        class_ids=class_ids,
        activity_id=activity_id,
        category_id=category_id,
        general_only=general_only,
        user_id=member_user_id,
        assistance_scope="class_assisted" if assisted_only else None,
        product_id=product_id,
        is_class_collected=is_class_collected,
        limit=limit,
        offset=offset,
    )
    return [shop_svc.serialize_order_list_item(o) for o in orders]


@router.get(
    "/orders/class/members/{member_user_id}/registrations",
    response_model=list[OrderOut],
    summary="班級幹部檢視學生所有有效商品登記",
)
async def list_class_member_registrations(
    member_user_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    target, _, class_ids = await _get_class_member_target(session, current_user, member_user_id)
    orders = await shop_svc.get_class_member_registrations(session, target.id, class_ids)
    return [shop_svc.serialize_order(order) for order in orders]


@router.put(
    "/orders/class/members/{member_user_id}/products/{product_id}",
    response_model=list[OrderOut],
    summary="班級幹部調整學生商品總量",
)
async def set_class_member_product(
    member_user_id: uuid.UUID,
    product_id: uuid.UUID,
    payload: CurrentRegistrationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    target, target_class, class_ids = await _get_class_member_target(
        session, current_user, member_user_id
    )
    previous_orders = await shop_svc.get_class_member_registrations(session, target.id, class_ids)
    try:
        orders = await shop_svc.set_class_member_product(
            session,
            user=target,
            actor=current_user,
            class_id=target_class.id,
            class_ids=class_ids,
            product_id=product_id,
            data=payload,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="商品登記已更新，請重新整理後再試",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    active_order_ids = {order.id for order in orders}
    for previous_order in previous_orders:
        if previous_order.id in active_order_ids:
            continue
        cancelled_order = await shop_svc.get_order(session, previous_order.id)
        if cancelled_order is not None:
            await _broadcast_shop_order(cancelled_order)
    for order in orders:
        await _broadcast_shop_order(order)
    return [shop_svc.serialize_order(order) for order in orders]


@router.get(
    "/orders/class/summary",
    response_model=ShopClassSummaryOut,
    summary="班級幹部檢視本班商品訂購彙總",
)
async def class_order_summary(
    session: DbDep,
    current_user: CurrentUser,
    is_class_collected: bool | None = Query(None, description="篩選班代個人收款紀錄"),
    assisted_only: bool = Query(False, description="僅顯示班級幹部協助建立的訂單"),
    activity_id: uuid.UUID | None = Query(None, description="篩選活動"),
    category_id: uuid.UUID | None = Query(None, description="篩選未綁活動的商品分類"),
    general_only: bool = Query(False, description="僅顯示未綁活動的訂單"),
    product_id: uuid.UUID | None = Query(None, description="篩選商品"),
) -> ShopClassSummaryOut:
    class_ids = await _class_order_scope_ids(session, current_user)
    return await shop_svc.class_order_summary(
        session,
        class_ids=class_ids,
        activity_id=activity_id,
        category_id=category_id,
        general_only=general_only,
        assistance_scope="class_assisted" if assisted_only else None,
        product_id=product_id,
        is_class_collected=is_class_collected,
    )


@router.post(
    "/orders/class",
    response_model=list[OrderOut],
    status_code=status.HTTP_201_CREATED,
    summary="班級幹部替本班學生建立商品訂單",
)
async def create_class_order(
    payload: ClassOrderCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    return await _create_assisted_orders(payload, session, current_user)


@router.get(
    "/orders/recipients/{class_id}",
    response_model=list[ClassMemberOut],
    summary="訂單管理員查詢代訂學生名冊",
    dependencies=[Depends(require_any(*_PAYMENT_WRITE_CODES))],
)
async def list_order_recipients(class_id: uuid.UUID, session: DbDep) -> list[ClassMemberOut]:
    sc = await class_svc.get_class(session, class_id)
    if sc is None or not sc.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    return await class_svc.list_class_members(session, sc)


@router.post("/orders/{order_id}/separate", response_model=OrderOut, summary="將個別訂單獨立收款")
async def separate_order_collection(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> OrderOut:
    order = await shop_svc.get_order(session, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="找不到此訂單")
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not can_manage and (order.supplement_class_id or order.class_id) not in cadre_ids:
        raise HTTPException(status_code=403, detail="僅班聯或該班班代可獨立收款")
    try:
        order = await supplement_svc.separate_order(session, order, actor_id=current_user.id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_separate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"supplement_class_id": str(order.supplement_class_id)},
        summary=f"將訂單「{order.serial_number}」獨立收款",
    )
    await _broadcast_shop_order(order)
    return shop_svc.serialize_order(order)


@router.post(
    "/orders/{order_id}/rejoin-class", response_model=OrderOut, summary="將補收訂單歸回原班"
)
async def rejoin_supplement_order(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> OrderOut:
    order = await shop_svc.get_order(session, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="找不到此訂單")
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not can_manage and order.supplement_class_id not in cadre_ids:
        raise HTTPException(status_code=403, detail="僅班聯或原班班代可將訂單歸回班級")
    try:
        order = await supplement_svc.rejoin_class_order(session, order)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_rejoin_class",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"class_id": str(order.class_id), "is_class_collected": order.is_class_collected},
        summary=f"將訂單「{order.serial_number}」歸回原班級",
    )
    await _broadcast_shop_order(order)
    return shop_svc.serialize_order(order)


@router.get("/orders/supplements", response_model=list[OrderListItem], summary="補收款清單")
async def list_supplement_orders(
    session: DbDep,
    current_user: CurrentUser,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    cadre_ids = (
        None if can_manage else await class_svc.get_cadre_class_ids(session, current_user.id)
    )
    orders = await supplement_svc.list_supplements(
        session,
        actor_id=None if can_manage else current_user.id,
        class_ids=cadre_ids,
        limit=limit,
        offset=offset,
    )
    return [shop_svc.serialize_order_list_item(order) for order in orders]


@router.get("/orders/{order_id}/supplement-receipt.pdf", summary="下載單筆補收款收據")
async def download_supplement_receipt(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Response:
    order = await shop_svc.get_order(session, order_id)
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    if order is None or not (
        can_manage or current_user.id in {order.user_id, order.assisted_by_id}
    ):
        raise HTTPException(status_code=404, detail="找不到此補收款訂單")
    try:
        pdf = await supplement_svc.export_supplement_receipt(session, order)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="supplement-{order.serial_number}.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/orders/assisted",
    response_model=list[OrderOut],
    status_code=status.HTTP_201_CREATED,
    summary="訂單管理員替任意班級學生代訂",
    dependencies=[Depends(require_any(*_PAYMENT_WRITE_CODES))],
)
async def create_admin_assisted_order(
    payload: AdminAssistedOrderCreate, session: DbDep, current_user: CurrentUser
) -> list[OrderOut]:
    return await _create_assisted_orders(
        payload,
        session,
        current_user,
        allow_all_classes=True,
        separate_payment=payload.collection_mode == "separate",
        payment_method=payload.payment_method,
    )


async def _create_assisted_orders(
    payload: ClassOrderCreate,
    session: AsyncSession,
    current_user: User,
    *,
    allow_all_classes: bool = False,
    separate_payment: bool = False,
    payment_method: str = "cash_on_pickup",
) -> list[OrderOut]:
    from api.services.user_registration import UserRegistrationError

    try:
        if payload.roster_entry_id is not None:
            target, target_class = await class_svc.prepare_roster_order_recipient(
                session,
                roster_entry_id=payload.roster_entry_id,
                actor=current_user,
                allow_all_classes=allow_all_classes,
                product_ids=[item.product_id for item in payload.items],
            )
        else:
            target = await session.get(User, payload.user_id)
            if target is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此學生")
            if not target.is_active:
                raise PermissionError("此學生帳號已停用")
            target_class = await class_svc.resolve_user_class(session, target)
            cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
            if target_class is None or (
                not allow_all_classes
                and not current_user.is_superuser
                and target_class.id not in cadre_ids
            ):
                raise PermissionError("無權替此學生訂購")
        orders = await shop_svc.create_direct_order(
            session,
            user_id=target.id,
            class_id=target_class.id,
            data=ClassOrderUpsert(user_id=target.id, items=payload.items, notes=payload.notes),
            assisted_by_id=current_user.id,
            assistance_scope=("council_separate" if separate_payment else "council_assisted")
            if allow_all_classes
            else "class_assisted",
            payment_method=payment_method if separate_payment else "school_collection",
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except UserRegistrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="學生帳號或訂單資料已更新，請重新整理後再試",
        ) from e
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    result: list[OrderOut] = []
    for order in orders:
        full = await shop_svc.get_order(session, order.id)
        result.append(shop_svc.serialize_order(full or order))
        await _broadcast_shop_order(full or order)
    return result


@router.delete(
    "/orders",
    response_model=ShopOrdersClearOut,
    summary="清除全部商品訂購資料",
    description=(
        "僅限商品管理者。刪除所有商品訂單與訂單明細，清除相關應收款及尚未寄出的確認通知，"
        "並回補仍占用的有限庫存與優惠使用次數；商品目錄和稽核紀錄保留。"
    ),
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def clear_all_order_data(session: DbDep, current_user: CurrentUser) -> ShopOrdersClearOut:
    deleted_order_count = await shop_svc.clear_all_orders(session)
    await audit_svc.record(
        session,
        entity_type="shop_order_data",
        entity_id="all",
        action="shop.orders_clear_all",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"deleted_order_count": deleted_order_count},
        summary=f"清除全部商品訂購資料（{deleted_order_count} 筆訂單）",
    )
    return ShopOrdersClearOut(deleted_order_count=deleted_order_count)


@router.get(
    "/orders/analytics",
    response_model=ShopSalesAnalyticsOut,
    summary="活動與品項銷售分析（台北時間、最多 366 天）",
    dependencies=[Depends(require_any(*_ADMIN_VIEW_CODES))],
)
async def order_sales_analytics(
    session: DbDep,
    _: CurrentUser,
    date_from: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
    date_to: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
    compare: bool = Query(False),
    compare_from: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
    activity_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None, ge=0),
    class_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
) -> ShopSalesAnalyticsOut:
    try:
        return await sales_analytics(
            session,
            date_from=date_from,
            date_to=date_to,
            compare=compare,
            compare_from=compare_from,
            activity_id=activity_id,
            category_id=category_id,
            product_id=product_id,
            grade=grade,
            class_id=class_id,
            is_paid=is_paid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/orders/analytics/report",
    summary="產生銷售分析 PDF 或 Excel 報告",
    dependencies=[Depends(require_any(*_ADMIN_VIEW_CODES))],
    responses={
        200: {
            "content": {
                "application/pdf": {},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
            }
        }
    },
)
async def sales_analysis_report(
    session: DbDep, _: CurrentUser, data: ShopSalesReportCreate
) -> Response:
    try:
        content, media_type, filename = await create_sales_report(session, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "private, no-store",
        },
    )


@router.get(
    "/orders/summary",
    response_model=OrderSummaryOut,
    summary="後台訂購統計（按班級 / 年級 / 個人）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.FINANCE_VIEW,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def order_summary(
    session: DbDep,
    _: CurrentUser,
    group_by: str = Query("class", pattern="^(class|grade|user)$"),
    activity_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None, ge=0),
    class_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    is_paid: bool | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> OrderSummaryOut:
    return await shop_svc.order_summary(
        session,
        group_by=group_by,
        activity_id=activity_id,
        product_id=product_id,
        category_id=category_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status_filter,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/orders/class-payments",
    response_model=list[ClassPaymentReportItemOut],
    summary="班聯目前確認收款的班級明細",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.FINANCE_VIEW,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def class_payment_report(
    session: DbDep,
    _: CurrentUser,
) -> list[ClassPaymentReportItemOut]:
    return await shop_svc.class_payment_report(session)


# ── 商品規格數量彙總（班聯採購視圖）──────────────────────────────────────────────
# 注意：必須註冊在 /orders/{order_id} 之前，否則 Starlette 依註冊順序比對路由，
# GET /orders/quantities 會先被 {order_id} 這條路由攔截（"quantities" 不是合法
# UUID，導致 422 而非真正命中此端點）。


@router.get(
    "/orders/quantities",
    response_model=list[OrderQuantityRow],
    summary="商品規格訂購數量彙總（採購用）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def order_quantities(
    session: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None),
    class_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> list[OrderQuantityRow]:
    return await shop_svc.order_quantities(
        session,
        activity_id=activity_id,
        grade=grade,
        class_id=class_id,
        category_id=category_id,
        product_id=product_id,
        is_paid=is_paid,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/orders/{order_id}", response_model=OrderOut, summary="取得訂單詳情")
async def get_order(order_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    if order.user_id != current_user.id and not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_cadre = order.class_id is not None and order.class_id in cadre_ids
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, shop_svc._order_activity_id(order)
        )
        is_bound_delegate = await delegation_svc.can_view_order(session, current_user, order)
        if (
            not (_ADMIN_VIEW_CODES & set(codes))
            and not is_cadre
            and not is_activity_manager
            and not is_bound_delegate
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return shop_svc.serialize_order(order)


@router.post("/orders/{order_id}/cancel", response_model=OrderOut, summary="取消訂單")
async def cancel_order(
    order_id: uuid.UUID,
    payload: OrderCancelRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    codes = await get_user_permission_codes(session, current_user.id)
    is_order_manager = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    is_class_cadre = False
    if not is_order_manager:
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_class_cadre = order.class_id is not None and order.class_id in cadre_ids
        if order.user_id != current_user.id and not is_class_cadre:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權取消此訂單")
    try:
        order = await shop_svc.cancel_order(
            session,
            order,
            requested_by=current_user.id,
            reason=payload.reason,
            bypass_owner_check=is_order_manager or is_class_cadre,
            bypass_registration_window=is_order_manager or is_class_cadre,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_cancel",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "reason": payload.reason},
        summary=f"取消商品訂單「{order.serial_number}」",
    )
    refreshed = await shop_svc.get_order(session, order.id)
    updated = refreshed or order
    await _broadcast_shop_order(updated)
    return shop_svc.serialize_order(updated)


@router.patch("/orders/{order_id}", response_model=OrderOut, summary="截止前修改訂單品項")
async def update_order_items(
    order_id: uuid.UUID,
    payload: ClassOrderUpsert,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    is_cadre_of_class = order.class_id is not None and order.class_id in cadre_ids
    if order.user_id != current_user.id and not current_user.is_superuser and not is_cadre_of_class:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權修改此訂單")
    try:
        order = await shop_svc.replace_order_items(
            session,
            order,
            data=payload,
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    refreshed = await shop_svc.get_order(session, order.id)
    updated = refreshed or order
    await _broadcast_shop_order(updated)
    return shop_svc.serialize_order(updated)


@router.patch(
    "/orders/{order_id}/collection", response_model=OrderOut, summary="班代紀錄本班學生收款"
)
async def update_class_collection(
    order_id: uuid.UUID,
    payload: ClassCollectionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    was_class_collected = order.is_class_collected
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not current_user.is_superuser and (
        order.class_id is None or order.class_id not in cadre_ids
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="僅該班班代可紀錄收款")
    order = await shop_svc.set_class_collected(
        session, order, collected=payload.is_class_collected, actor_id=current_user.id
    )
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.class_collection",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"is_class_collected": payload.is_class_collected},
        summary=f"班代紀錄訂單「{order.serial_number}」收款狀態",
    )
    full = await shop_svc.get_order(session, order.id)
    updated = full or order
    if payload.is_class_collected and not was_class_collected:
        buyer = await session.get(User, updated.user_id)
        if buyer is not None:
            await _queue_order_confirmation(session, buyer, updated)
    await _broadcast_shop_order(updated)
    return shop_svc.serialize_order(updated)


@router.get(
    "/orders/classes/{class_id}/receipt.pdf",
    summary="下載班級收款簽收單（收執聯與存根聯）",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_class_receipt(
    class_id: uuid.UUID,
    session: DbDep,
    activity_id: uuid.UUID | None = Query(None, description="活動；未提供時僅匯出一般商品"),
) -> Response:
    school_class = await session.get(SchoolClass, class_id)
    if school_class is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    try:
        pdf = await shop_svc.export_class_receipt_pdf(
            session, school_class, activity_id=activity_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename = f"班聯收款簽收單-{school_class.class_code}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "no-store",
        },
    )


@router.patch(
    "/orders/classes/{class_id}/payment",
    response_model=ClassPaymentOut,
    summary="班聯會確認整班繳款",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def update_class_payment(
    class_id: uuid.UUID,
    payload: ClassPaymentUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ClassPaymentOut:
    if await session.get(SchoolClass, class_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此班級")
    if payload.activity_id is not None:
        or_404(await activity_svc.get_activity(session, payload.activity_id), "找不到此活動")
    orders = await shop_svc.set_class_paid(
        session,
        class_id,
        is_paid=payload.is_paid,
        actor_id=current_user.id,
        activity_id=payload.activity_id,
    )
    await audit_svc.record(
        session,
        entity_type="school_class",
        entity_id=str(class_id),
        action="shop.class_payment",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "is_paid": payload.is_paid,
            "order_count": len(orders),
            "activity_id": str(payload.activity_id) if payload.activity_id else None,
        },
        summary=f"班聯會標示整班{'已繳費' if payload.is_paid else '未繳費'}（單一活動）",
    )
    for order in orders:
        await _broadcast_shop_order(order)
    return ClassPaymentOut(
        class_id=class_id,
        activity_id=payload.activity_id,
        updated_orders=len(orders),
        is_paid=payload.is_paid,
    )


@router.patch(
    "/orders/{order_id}/payment", response_model=OrderOut, summary="管理員標示單筆訂單是否已繳費"
)
async def update_order_payment(
    order_id: uuid.UUID,
    payload: OrderPaymentUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session, current_user)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, shop_svc._order_activity_id(order)
        )
        if not (_PAYMENT_WRITE_CODES & set(codes)) and not is_activity_manager:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="僅班聯會管理員可標示正式繳費"
            )
    order = await shop_svc.set_order_paid(
        session, order, is_paid=payload.is_paid, actor_id=current_user.id
    )
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_payment",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "is_paid": payload.is_paid},
        summary=f"標示訂單「{order.serial_number}」{'已繳費' if payload.is_paid else '未繳費'}",
    )
    refreshed = await shop_svc.get_order(session, order.id)
    updated = refreshed or order
    await _broadcast_shop_order(updated)
    return shop_svc.serialize_order(updated)


# ── 報表匯出 ──────────────────────────────────────────────────────────────────


@router.get(
    "/reports/orders.xlsx",
    response_class=Response,
    summary="匯出訂單報表（Excel）",
)
async def export_orders_excel(
    session: DbDep,
    current_user: CurrentUser,
    activity_id: uuid.UUID | None = Query(None, description="過濾活動"),
) -> Response:
    if activity_id:
        await _require_shop_manager(session, current_user, activity_id)
    elif not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        if not {str(PermissionCode.FINANCE_VIEW), str(PermissionCode.ADMIN_ALL)} & set(codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：finance:view"
            )
    xlsx_bytes = await shop_svc.export_orders_excel(session, activity_id=activity_id)
    filename = f"orders_{local_today()}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/reports/orders.csv",
    response_class=Response,
    summary="匯出訂單報表（CSV）",
)
async def export_orders_csv(
    session: DbDep,
    current_user: CurrentUser,
    activity_id: uuid.UUID | None = Query(None, description="過濾活動"),
) -> Response:
    if activity_id:
        await _require_shop_manager(session, current_user, activity_id)
    elif not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        if not {str(PermissionCode.FINANCE_VIEW), str(PermissionCode.ADMIN_ALL)} & set(codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：finance:view"
            )
    csv_str = await shop_svc.export_orders_csv(session, activity_id=activity_id)
    filename = f"orders_{local_today()}.csv"
    return Response(
        content=csv_str.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── 結單管理 ──────────────────────────────────────────────────────────────────


_COUNCIL_CODES = {
    PermissionCode.SHOP_MANAGE,
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.SHOP_VIEW_ALL,
    PermissionCode.ADMIN_ALL,
}


async def _assert_close_permission(
    session: AsyncSession,
    current_user: User,
    target_class_id: uuid.UUID | None,
) -> None:
    """班代僅設定本班期限；班聯管理全域結單。"""
    if current_user.is_superuser:
        return
    codes = await get_user_permission_codes(session, current_user.id)
    if _COUNCIL_CODES & set(codes):
        return
    if target_class_id is not None:
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        if target_class_id in cadre_ids:
            return
    raise HTTPException(status_code=403, detail="無結單權限")


@router.get("/categories/{category_id}/class-deadline", response_model=ShopOrderCloseOut | None)
async def read_class_deadline(
    category_id: uuid.UUID, class_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> ShopOrderCloseOut | None:
    await _get_category_or_404(category_id, session)
    await _assert_close_permission(session, current_user, class_id)
    close = await class_settlement_svc.get_class_deadline(session, category_id, class_id)
    return shop_svc._serialize_close(close) if close is not None else None


@router.post(
    "/categories/{category_id}/close",
    response_model=ShopOrderCloseOut,
    status_code=status.HTTP_201_CREATED,
    summary="結單：關閉指定班級（或全局）的訂購",
)
async def close_category(
    category_id: uuid.UUID,
    payload: ShopOrderCloseCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopOrderCloseOut:
    await _get_category_or_404(category_id, session)
    await _assert_close_permission(session, current_user, payload.class_id)
    try:
        close = await shop_svc.close_category_for_class(
            session,
            category_id=category_id,
            class_id=payload.class_id,
            closed_by_id=current_user.id,
            notes=payload.notes,
            closes_at=payload.closes_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="shop_category",
        entity_id=str(category_id),
        action="shop.order_close",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "class_id": str(payload.class_id) if payload.class_id else None,
            "closes_at": payload.closes_at.isoformat() if payload.closes_at else None,
        },
        summary=f"結單：商品分類「{category_id}」{'全局' if not payload.class_id else '班級'}",
    )
    return shop_svc._serialize_close(close)


@router.delete(
    "/categories/{category_id}/close",
    response_model=ShopOrderCloseOut,
    summary="重新開單：重開指定班級（或全局）的訂購",
)
async def reopen_category(
    category_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    class_id: uuid.UUID | None = Query(None, description="班級 ID，None=全局"),
) -> ShopOrderCloseOut:
    await _get_category_or_404(category_id, session)
    await _assert_close_permission(session, current_user, class_id)
    try:
        close = await shop_svc.reopen_category_for_class(
            session,
            category_id=category_id,
            class_id=class_id,
            reopened_by_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="shop_category",
        entity_id=str(category_id),
        action="shop.order_reopen",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"class_id": str(class_id) if class_id else None},
        summary=f"重新開單：商品分類「{category_id}」",
    )
    return shop_svc._serialize_close(close)


@router.get(
    "/close-status",
    response_model=CloseStatusOut,
    summary="查詢各分類結單狀態",
)
async def get_close_status(
    session: DbDep,
    current_user: CurrentUser,
    category_ids: list[uuid.UUID] = Query(..., description="要查詢的分類 ID 列表"),
    class_id: uuid.UUID | None = Query(None, description="指定班級（不填則用登入者的班）"),
) -> CloseStatusOut:
    from api.services import school_class as class_svc_inner

    # 管理員一次查詢多個班級時，指定的 class_id 已足夠決定資料範圍；
    # 一般使用者仍需解析自己的班級，才能判斷是否可顯示收款細節。
    own_class = None
    if class_id is None or not current_user.is_superuser:
        own_class = await class_svc_inner.resolve_user_class(session, current_user)
    if class_id is None:
        class_id = own_class.id if own_class else None

    close_map = await shop_svc.get_close_status(session, category_ids, class_id)
    collection_details = await shop_svc.get_close_status_collection_details(
        session,
        category_ids,
        class_id if current_user.is_superuser or (own_class and class_id == own_class.id) else None,
    )
    statuses: dict[str, CloseStatusItem] = {}
    for category_id, item in close_map.items():
        status_item = item or CloseStatusItem(is_closed=False)
        details = collection_details.get(category_id)
        if details:
            status_item = status_item.model_copy(update=details)
        statuses[str(category_id)] = status_item
    return CloseStatusOut(statuses=statuses)


# ── 學生授權的家人代訂 ────────────────────────────────────────────────────────


async def _delegation_result[T](operation: Awaitable[T]) -> T:
    try:
        return await operation
    except (delegation_svc.DelegationError, delegation_code_svc.DelegationCodeError) as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except StaleDataError as error:
        raise HTTPException(status_code=409, detail="庫存已更新，請重新載入") from error
    except shop_svc.PurchaseLimitError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/delegation-links", response_model=list[ShopDelegationOut])
async def list_delegation_links(
    session: DbDep, current_user: CurrentUser
) -> list[ShopDelegationOut]:
    return await delegation_svc.list_links(session, current_user)


@router.post("/delegation-links", response_model=ShopDelegationOut, status_code=201)
async def create_delegation_link(
    payload: ShopDelegationCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationOut:
    return await _delegation_result(delegation_svc.create_link(session, current_user, payload))


@router.patch("/delegation-links/{link_id}", response_model=ShopDelegationOut)
async def rename_delegation_link(
    link_id: uuid.UUID,
    payload: ShopDelegationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationOut:
    return await _delegation_result(
        delegation_svc.rename_link(
            session,
            current_user,
            link_id,
            payload.name,
        )
    )


@router.delete("/delegation-links/{link_id}", status_code=204)
async def revoke_delegation_link(
    link_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    link = await _delegation_result(delegation_svc.revoke_link(session, current_user, link_id))
    await audit_svc.record(
        session,
        entity_type="shop_delegation_link",
        entity_id=str(link.id),
        action="shop.delegation_revoke",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"撤銷代訂連結「{link.name}」",
    )


@router.post("/delegation-links/{link_id}/renew", response_model=ShopDelegationOut, status_code=201)
async def renew_delegation_link(
    link_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationOut:
    return await _delegation_result(delegation_svc.renew_link(session, current_user, link_id))


@router.post("/delegation/access", response_model=ShopDelegationContextOut)
async def access_delegation(
    payload: ShopDelegationAccess,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationContextOut:
    result = await _delegation_result(
        delegation_svc.context(
            session,
            current_user,
            payload.token,
            claim=payload.claim,
        )
    )
    if payload.claim:
        await audit_svc.record(
            session,
            entity_type="shop_delegation_link",
            entity_id=str(result.link.id),
            action="shop.delegation_claim",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            summary=f"綁定代訂連結「{result.link.name}」",
        )
    return result


@router.post("/delegation/code", response_model=ShopDelegationCodeOut)
async def exchange_delegation_code(
    payload: ShopDelegationCodeCreate,
    request: Request,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationCodeOut:
    token = await _delegation_result(
        delegation_code_svc.exchange_code(
            payload.code,
            actor_id=str(current_user.id),
            client_ip=request.client.host if request.client else "unknown",
        )
    )
    # 回傳完整連結前必須確認未撤銷、帳號綁定、學生／活動仍有效及商品開放範圍。
    await _delegation_result(delegation_svc.resolve_link(session, current_user, token))
    return ShopDelegationCodeOut(token=token)


@router.post("/delegation/products/{product_id}/read", response_model=ProductOut)
async def read_delegation_product(
    product_id: uuid.UUID,
    payload: ShopDelegationAccess,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductOut:
    return await _delegation_result(
        delegation_svc.delegated_product(
            session,
            current_user,
            payload.token,
            product_id,
        )
    )


async def _delegation_order_response(
    session: AsyncSession,
    actor: User,
    order: Order | None,
) -> OrderOut | None:
    if order is None:
        return None
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.delegation_update",
        actor_id=str(actor.id),
        actor_email=actor.email,
        summary=f"更新代訂登記「{order.serial_number}」",
    )
    full = await shop_svc.get_order(session, order.id)
    updated = full or order
    await _broadcast_shop_order(updated)
    return shop_svc.serialize_order(updated)


@router.post("/delegation/products/{product_id}", response_model=OrderOut | None)
async def update_delegation_product(
    product_id: uuid.UUID,
    payload: ShopDelegationRegistrationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut | None:
    order = await _delegation_result(
        delegation_svc.set_product(
            session,
            current_user,
            payload.token,
            product_id,
            CurrentRegistrationUpdate(variants=payload.variants),
        )
    )
    return await _delegation_order_response(session, current_user, order)


@router.post("/delegation/promotion/preview", response_model=ShopPromotionPreviewOut)
async def preview_delegation_promotion(
    payload: ShopDelegationPromotionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopPromotionPreviewOut:
    link, student = await _delegation_result(
        delegation_svc.resolve_link(
            session,
            current_user,
            payload.token,
            write=True,
        )
    )
    return await _delegation_result(delegation_svc.preview(session, student, link, payload.code))


@router.post("/delegation/promotion", response_model=OrderOut)
async def apply_delegation_promotion(
    payload: ShopDelegationPromotionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    link, student = await _delegation_result(
        delegation_svc.resolve_link(
            session,
            current_user,
            payload.token,
            write=True,
        )
    )
    order = await _delegation_result(
        shop_svc.apply_registration_promotion(
            session,
            student,
            code=payload.code,
            activity_id=link.activity_id,
            category_id=None if link.activity_id else link.category_id,
        )
    )
    result = await _delegation_order_response(session, current_user, order)
    assert result is not None
    return result


@router.patch("/orders/{order_id}/items/{item_id}", response_model=OrderOut | None)
async def update_owned_order_item(
    order_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: OrderItemQuantityUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut | None:
    codes = await get_user_permission_codes(session, current_user.id)
    is_order_manager = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    if is_order_manager:
        order = await _get_order_or_404(order_id, session, current_user)
        try:
            updated_order = await orders_svc.update_order_item_quantity(
                session,
                order,
                item_id,
                quantity=payload.quantity,
            )
        except StaleDataError as error:
            raise HTTPException(status_code=409, detail="庫存已更新，請重新載入") from error
        except shop_svc.PurchaseLimitError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        await audit_svc.record(
            session,
            entity_type="order",
            entity_id=str(updated_order.id),
            action="shop.order_item_quantity_update",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={
                "serial_number": updated_order.serial_number,
                "item_id": str(item_id),
                "quantity": payload.quantity,
            },
            summary=f"調整商品訂單「{updated_order.serial_number}」品項數量",
        )
        refreshed = await shop_svc.get_order(session, updated_order.id)
        result = refreshed or updated_order
        await _broadcast_shop_order(result)
        return shop_svc.serialize_order(result)

    order = await _delegation_result(
        delegation_svc.update_owned_item(
            session,
            current_user,
            order_id,
            item_id,
            payload.quantity,
        )
    )
    return await _delegation_order_response(session, current_user, order)
