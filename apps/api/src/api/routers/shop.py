"""商品訂購系統 Router - 分類 / 變體 / 商品 / 購物車 / 結單 / 統計 / 報表"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from api.core.clock import local_today
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any, require_permission
from api.models.shop import (
    Order,
    OrderStatus,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.models.user import User
from api.routers._common import or_404
from api.schemas.shop import (
    CartItemCreate,
    CartItemUpdate,
    CartOut,
    CatalogCategoryOut,
    CheckoutRequest,
    ClassOrderUpsert,
    CloseStatusOut,
    ImageUploadOut,
    OrderCancelRequest,
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
    ShopClassSummaryOut,
    ShopOrderCloseCreate,
    ShopOrderCloseOut,
)
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shop", tags=["商品訂購"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.SHOP_MANAGE))]

_ADMIN_VIEW_CODES = {
    PermissionCode.SHOP_MANAGE_ORDERS,
    PermissionCode.SHOP_VIEW_ALL,
    PermissionCode.FINANCE_VIEW,
    PermissionCode.ADMIN_ALL,
}


# ── 輔助 ─────────────────────────────────────────────────────────────────────


async def _get_category_or_404(category_id: uuid.UUID, session: AsyncSession) -> ProductCategory:
    obj = await shop_svc.get_category(session, category_id)
    return or_404(obj, "找不到此主題")


async def _get_series_or_404(series_id: uuid.UUID, session: AsyncSession) -> ProductSeries:
    obj = await shop_svc.get_series(session, series_id)
    return or_404(obj, "找不到此系列")


async def _get_product_or_404(product_id: uuid.UUID, session: AsyncSession) -> Product:
    p = await shop_svc.get_product(session, product_id)
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


async def _get_order_or_404(order_id: uuid.UUID, session: AsyncSession) -> Order:
    o = await shop_svc.get_order(session, order_id)
    return or_404(o, "找不到此訂單")


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
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
) -> list[CatalogCategoryOut]:
    return await shop_svc.build_catalog_tree(session, activity_id=activity_id)


# ── 商品 ──────────────────────────────────────────────────────────────────────


@router.get("/products", response_model=list[ProductOut], summary="列出商品")
async def list_products(
    session: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    series_id: uuid.UUID | None = Query(None),
    status_filter: ProductStatus | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Product]:
    return await shop_svc.list_products(
        session,
        activity_id=activity_id,
        series_id=series_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/products/{product_id}", response_model=ProductOut, summary="取得商品詳情")
async def get_product(product_id: uuid.UUID, session: DbDep, _: CurrentUser) -> Product:
    return await _get_product_or_404(product_id, session)


@router.post(
    "/products",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增商品（可附變體）",
)
async def create_product(
    payload: ProductCreate, session: DbDep, current_user: CurrentUser
) -> Product:
    series = await _get_series_or_404(payload.series_id, session)
    category = await _get_category_or_404(series.category_id, session)
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
    product = await _get_product_or_404(product_id, session)
    await _require_shop_manager(session, current_user, _product_activity(product))
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


@router.post("/products/{product_id}/activate", response_model=ProductOut, summary="上架商品")
async def activate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session)
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
    product = await _get_product_or_404(product_id, session)
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
    product = await _get_product_or_404(product_id, session)
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
    product = await _get_product_or_404(group.product_id, session)
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
    product = await _get_product_or_404(group.product_id, session)
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
    product = await _get_product_or_404(group.product_id, session)
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
    product = await _get_product_or_404(group.product_id, session)
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
    product = await _get_product_or_404(group.product_id, session)
    await _require_shop_manager(session, current_user, _product_activity(product))
    await shop_svc.delete_variant_option(session, option)


# ── 購物車 ────────────────────────────────────────────────────────────────────


@router.get("/cart", response_model=CartOut, summary="檢視購物車")
async def get_cart(session: DbDep, current_user: CurrentUser) -> CartOut:
    cart = await shop_svc.get_or_create_cart(session, current_user.id)
    return shop_svc.serialize_cart(cart)


@router.post(
    "/cart/items",
    response_model=CartOut,
    status_code=status.HTTP_201_CREATED,
    summary="加入購物車",
)
async def add_cart_item(
    payload: CartItemCreate, session: DbDep, current_user: CurrentUser
) -> CartOut:
    try:
        cart = await shop_svc.add_cart_item(session, current_user.id, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return shop_svc.serialize_cart(cart)


@router.patch("/cart/items/{item_id}", response_model=CartOut, summary="調整購物車品項數量")
async def update_cart_item(
    item_id: uuid.UUID,
    payload: CartItemUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> CartOut:
    try:
        cart = await shop_svc.update_cart_item(
            session, current_user.id, item_id, quantity=payload.quantity
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return shop_svc.serialize_cart(cart)


@router.delete("/cart/items/{item_id}", response_model=CartOut, summary="移除購物車品項")
async def remove_cart_item(
    item_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> CartOut:
    try:
        cart = await shop_svc.remove_cart_item(session, current_user.id, item_id)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    return shop_svc.serialize_cart(cart)


@router.delete("/cart", response_model=CartOut, summary="清空購物車")
async def clear_cart(session: DbDep, current_user: CurrentUser) -> CartOut:
    cart = await shop_svc.clear_cart(session, current_user.id)
    return shop_svc.serialize_cart(cart)


@router.post(
    "/cart/checkout",
    response_model=list[OrderOut],
    status_code=status.HTTP_201_CREATED,
    summary="購物車送單（依組織拆單，依班級歸戶）",
)
async def checkout(
    payload: CheckoutRequest, session: DbDep, current_user: CurrentUser
) -> list[OrderOut]:
    try:
        orders = await shop_svc.checkout(session, current_user, notes=payload.notes)
    except StaleDataError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="庫存發生並發衝突，請稍後重試（商品已被他人搶購更新）",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    result: list[OrderOut] = []
    for order in orders:
        await audit_svc.record(
            session,
            entity_type="order",
            entity_id=str(order.id),
            action="shop.order_create",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"serial_number": order.serial_number, "total_price": order.total_price},
            summary=f"送出商品訂單「{order.serial_number}」",
        )
        full = await shop_svc.get_order(session, order.id)
        if full is not None:
            result.append(shop_svc.serialize_order(full))
        try:
            from api.services.outbox import emit as outbox_emit

            await outbox_emit(
                session,
                event_type="shop.order_confirmed",
                payload={
                    "order_id": str(order.id),
                    "serial_number": order.serial_number,
                    "buyer_id": str(current_user.id),
                    "buyer_email": current_user.email or "",
                    "buyer_name": current_user.display_name or "",
                    "total_price": order.total_price,
                },
            )
        except Exception:
            logger.warning("emit shop.order_confirmed failed", exc_info=True)
    return result


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
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    is_admin = current_user.is_superuser
    if not is_admin:
        codes = await get_user_permission_codes(session, str(current_user.id))
        is_admin = bool(_ADMIN_VIEW_CODES & set(codes))
    if is_admin or (
        activity_id
        and await activity_svc.can_manage_activity_resource(session, current_user, activity_id)
    ):
        my_only = False
    elif not my_only:
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
        limit=limit,
        offset=offset,
    )
    return [shop_svc.serialize_order_list_item(o) for o in orders]


@router.get(
    "/orders/class",
    response_model=list[OrderListItem],
    summary="班級幹部檢視本班訂單",
)
async def list_class_orders(
    session: DbDep,
    current_user: CurrentUser,
    is_paid: bool | None = Query(None, description="篩選繳費狀態"),
    assisted_only: bool = Query(False, description="僅顯示班級幹部協助建立的訂單"),
    product_id: uuid.UUID | None = Query(None, description="篩選商品"),
    member_user_id: uuid.UUID | None = Query(None, description="篩選特定學生"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    class_ids = list(await class_svc.get_cadre_class_ids(session, current_user.id))
    orders = await shop_svc.list_orders(
        session,
        class_ids=class_ids,
        user_id=member_user_id,
        assistance_scope="class_assisted" if assisted_only else None,
        product_id=product_id,
        is_paid=is_paid,
        limit=limit,
        offset=offset,
    )
    return [shop_svc.serialize_order_list_item(o) for o in orders]


@router.get(
    "/orders/class/summary",
    response_model=ShopClassSummaryOut,
    summary="班級幹部檢視本班商品訂購彙總",
)
async def class_order_summary(
    session: DbDep,
    current_user: CurrentUser,
    is_paid: bool | None = Query(None, description="篩選繳費狀態"),
    assisted_only: bool = Query(False, description="僅顯示班級幹部協助建立的訂單"),
    product_id: uuid.UUID | None = Query(None, description="篩選商品"),
) -> ShopClassSummaryOut:
    class_ids = list(await class_svc.get_cadre_class_ids(session, current_user.id))
    return await shop_svc.class_order_summary(
        session,
        class_ids=class_ids,
        assistance_scope="class_assisted" if assisted_only else None,
        product_id=product_id,
        is_paid=is_paid,
    )


@router.post(
    "/orders/class",
    response_model=list[OrderOut],
    status_code=status.HTTP_201_CREATED,
    summary="班級幹部替本班學生建立商品訂單",
)
async def create_class_order(
    payload: ClassOrderUpsert,
    session: DbDep,
    current_user: CurrentUser,
) -> list[OrderOut]:
    target = await session.get(User, payload.user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此學生")
    target_class = await class_svc.resolve_user_class(session, target)
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if target_class is None or (not current_user.is_superuser and target_class.id not in cadre_ids):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權替此學生訂購")
    try:
        orders = await shop_svc.create_direct_order(
            session,
            user_id=target.id,
            class_id=target_class.id,
            data=payload,
            assisted_by_id=current_user.id,
        )
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    result: list[OrderOut] = []
    for order in orders:
        full = await shop_svc.get_order(session, order.id)
        result.append(shop_svc.serialize_order(full or order))
    return result


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
    product_id: uuid.UUID | None = Query(None),
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
        product_id=product_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status_filter,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )


@router.get("/orders/{order_id}", response_model=OrderOut, summary="取得訂單詳情")
async def get_order(order_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> OrderOut:
    order = await _get_order_or_404(order_id, session)
    if order.user_id != current_user.id and not current_user.is_superuser:
        codes = await get_user_permission_codes(session, str(current_user.id))
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_cadre = order.class_id is not None and order.class_id in cadre_ids
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, shop_svc._order_activity_id(order)
        )
        if not (_ADMIN_VIEW_CODES & set(codes)) and not is_cadre and not is_activity_manager:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return shop_svc.serialize_order(order)


@router.post("/orders/{order_id}/cancel", response_model=OrderOut, summary="取消訂單")
async def cancel_order(
    order_id: uuid.UUID,
    payload: OrderCancelRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session)
    bypass = current_user.is_superuser
    if not bypass and order.user_id != current_user.id:
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        bypass = order.class_id is not None and order.class_id in cadre_ids
        if not bypass:
            codes = await get_user_permission_codes(session, str(current_user.id))
            bypass = bool(_ADMIN_VIEW_CODES & set(codes))
        if not bypass:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權取消此訂單")
    try:
        order = await shop_svc.cancel_order(
            session,
            order,
            requested_by=current_user.id,
            reason=payload.reason,
            bypass_owner_check=bypass,
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
    return shop_svc.serialize_order(refreshed or order)


@router.patch("/orders/{order_id}", response_model=OrderOut, summary="截止前修改訂單品項")
async def update_order_items(
    order_id: uuid.UUID,
    payload: ClassOrderUpsert,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session)
    if order.user_id != current_user.id and not current_user.is_superuser:
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_cadre_of_class = order.class_id is not None and order.class_id in cadre_ids
        if not is_cadre_of_class:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權修改此訂單")
    try:
        order = await shop_svc.replace_order_items(session, order, data=payload)
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    refreshed = await shop_svc.get_order(session, order.id)
    return shop_svc.serialize_order(refreshed or order)


@router.patch("/orders/{order_id}/payment", response_model=OrderOut, summary="標示訂單是否已繳費")
async def update_order_payment(
    order_id: uuid.UUID,
    payload: OrderPaymentUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    order = await _get_order_or_404(order_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes(session, str(current_user.id))
        cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
        is_cadre = order.class_id is not None and order.class_id in cadre_ids
        is_activity_manager = await activity_svc.can_manage_activity_resource(
            session, current_user, shop_svc._order_activity_id(order)
        )
        if not (_ADMIN_VIEW_CODES & set(codes)) and not is_cadre and not is_activity_manager:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="僅該班幹部或管理員可標示繳費"
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
    return shop_svc.serialize_order(refreshed or order)


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
    """確認結單權限：
    - 超管或 council codes → 任意班
    - ClassCadre → 只能操作自己班
    """
    if current_user.is_superuser:
        return
    codes = await get_user_permission_codes(session, str(current_user.id))
    if _COUNCIL_CODES & set(codes):
        return
    cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if target_class_id is not None and target_class_id in cadre_ids:
        return
    if target_class_id is None and cadre_ids:
        # 幹部只能指定 class_id，不可全局結單
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="僅系統管理員可執行全局結單，班級幹部請指定班級",
        )
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無結單權限")


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
        meta={"class_id": str(payload.class_id) if payload.class_id else None},
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
    from api.models.school_class import SchoolClass
    from api.services import school_class as class_svc_inner

    if class_id is None:
        school_class = await class_svc_inner.resolve_user_class(session, current_user)
        class_id = school_class.id if school_class else None

    close_map = await shop_svc.get_close_status(session, category_ids, class_id)
    statuses: dict[str, dict] = {}
    for cid, row in close_map.items():
        if row is None:
            statuses[str(cid)] = {"is_closed": False}
        else:
            closed_by_name = None
            if row.closed_by:
                closed_by_name = getattr(row.closed_by, "display_name", None)
            statuses[str(cid)] = {
                "is_closed": True,
                "closed_at": row.created_at,
                "closed_by_name": closed_by_name,
            }
    return CloseStatusOut(statuses=statuses)


# ── 商品規格數量彙總（班聯採購視圖）──────────────────────────────────────────────


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
    grade: int | None = Query(None),
    class_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
) -> list[OrderQuantityRow]:
    return await shop_svc.order_quantities(
        session,
        grade=grade,
        class_id=class_id,
        category_id=category_id,
        product_id=product_id,
        is_paid=is_paid,
        status=status_filter,
    )
