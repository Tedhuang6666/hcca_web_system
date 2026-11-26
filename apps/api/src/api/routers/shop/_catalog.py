from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.shop import (
    ProductCategory,
    ProductSeries,
)
from api.routers._common import or_404
from api.routers.shop._common import (
    _ADMIN_VIEW_CODES,
    CurrentUser,
    DbDep,
    OptionalUser,
    _class_purchase_buyer,
    _get_category_or_404,
    _get_series_or_404,
    _require_shop_manager,
)
from api.schemas.activity import ActivityOut
from api.schemas.shop import (
    CatalogCategoryOut,
    ImageUploadOut,
    ProductCategoryCreate,
    ProductCategoryOut,
    ProductCategoryUpdate,
    ProductSeriesCreate,
    ProductSeriesOut,
    ProductSeriesUpdate,
    ShopActivityDeadlineUpdate,
    ShopActivityOrderClosureUpdate,
)
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop._deadlines import set_activity_order_closure, set_activity_order_deadline
from api.services.shop._testing import can_test_products
from api.services.storage import get_storage

router = APIRouter()


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
async def list_shop_activities(
    session: DbDep, current_user: CurrentUser, include_inactive: bool = Query(False)
) -> list[ActivityOut]:
    permission_codes = await get_user_permission_codes(session, current_user.id)
    can_view_all = current_user.is_superuser or any(
        str(code) in permission_codes for code in _ADMIN_VIEW_CODES
    )
    if include_inactive and not can_view_all:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="沒有權限檢視封存活動")
    if can_view_all:
        activities = await activity_svc.list_activities(session, active_only=not include_inactive)
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


@router.get("/catalog", response_model=list[CatalogCategoryOut], summary="購買頁瀏覽樹")
async def get_catalog(
    session: DbDep,
    current_user: OptionalUser,
    activity_id: uuid.UUID | None = Query(None),
    include_closed: bool = Query(False, description="包含已結單活動，供登入後查詢與收款"),
    class_member_id: uuid.UUID | None = Query(None, description="班代代購的學生或名冊 ID"),
    direct_path: list[str] = Query(
        default=[], description="只解析公開商品連結對應的分類與商品，可顯示已結單商品"
    ),
) -> list[CatalogCategoryOut]:
    if include_closed and current_user is None and not direct_path:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請先登入")
    if direct_path and len(direct_path) not in (1, 2):
        return []
    buyer = await _class_purchase_buyer(session, current_user, class_member_id)
    catalog = await shop_svc.build_catalog_tree(
        session,
        activity_id=activity_id,
        include_testing=await can_test_products(session, current_user),
        include_closed=include_closed or bool(direct_path),
        buyer=buyer,
    )
    return (
        shop_svc.filter_catalog_to_direct_product(catalog, direct_path) if direct_path else catalog
    )
