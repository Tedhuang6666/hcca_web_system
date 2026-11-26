from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.shop import (
    ProductCategory,
    ProductSeries,
)
from api.routers.shop._common import (
    CurrentUser,
    DbDep,
    OptionalUser,
    _class_purchase_buyer,
    _get_category_or_404,
    _get_series_or_404,
    _require_shop_manager,
)
from api.schemas.shop import (
    CatalogCategoryOut,
    ImageUploadOut,
    ProductCategoryCreate,
    ProductCategoryOut,
    ProductCategoryReorder,
    ProductCategoryUpdate,
    ProductSeriesCreate,
    ProductSeriesOut,
    ProductSeriesReorder,
    ProductSeriesUpdate,
)
from api.services import shop as shop_svc
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
    include_inactive: bool = Query(True),
) -> list[ProductCategory]:
    return await shop_svc.list_categories(session, include_inactive=include_inactive)


@router.post(
    "/categories",
    response_model=ProductCategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增主題",
)
async def create_category(
    payload: ProductCategoryCreate, session: DbDep, current_user: CurrentUser
) -> ProductCategory:
    await _require_shop_manager(session, current_user)
    return await shop_svc.create_category(session, data=payload, created_by=current_user.id)


@router.patch("/categories/order", response_model=list[ProductCategoryOut], summary="調整主題順序")
async def reorder_categories(
    payload: ProductCategoryReorder, session: DbDep, current_user: CurrentUser
) -> list[ProductCategory]:
    await _require_shop_manager(session, current_user)
    try:
        return await shop_svc.reorder_categories(session, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.patch("/categories/{category_id}", response_model=ProductCategoryOut, summary="更新主題")
async def update_category(
    category_id: uuid.UUID,
    payload: ProductCategoryUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductCategory:
    category = await _get_category_or_404(category_id, session)
    await _require_shop_manager(session, current_user)
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
    await _require_shop_manager(session, current_user)
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
    await _get_category_or_404(payload.category_id, session)
    await _require_shop_manager(session, current_user)
    try:
        return await shop_svc.create_series(session, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


@router.patch("/series/order", response_model=list[ProductSeriesOut], summary="調整系列順序")
async def reorder_series(
    payload: ProductSeriesReorder, session: DbDep, current_user: CurrentUser
) -> list[ProductSeries]:
    await _get_category_or_404(payload.category_id, session)
    await _require_shop_manager(session, current_user)
    try:
        return await shop_svc.reorder_series(session, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.patch("/series/{series_id}", response_model=ProductSeriesOut, summary="更新系列")
async def update_series(
    series_id: uuid.UUID,
    payload: ProductSeriesUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductSeries:
    series = await _get_series_or_404(series_id, session)
    await _get_category_or_404(series.category_id, session)
    await _require_shop_manager(session, current_user)
    return await shop_svc.update_series(session, series, data=payload)


@router.delete(
    "/series/{series_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除系列",
)
async def delete_series(series_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    series = await _get_series_or_404(series_id, session)
    await _get_category_or_404(series.category_id, session)
    await _require_shop_manager(session, current_user)
    try:
        await shop_svc.delete_series(session, series)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.get("/catalog", response_model=list[CatalogCategoryOut], summary="購買頁瀏覽樹")
async def get_catalog(
    session: DbDep,
    current_user: OptionalUser,
    category_id: uuid.UUID | None = Query(None),
    include_closed: bool = Query(False, description="包含已結單分類，供登入後查詢與收款"),
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
        category_id=category_id,
        include_testing=await can_test_products(session, current_user),
        include_closed=include_closed or bool(direct_path),
        buyer=buyer,
    )
    return (
        shop_svc.filter_catalog_to_direct_product(catalog, direct_path) if direct_path else catalog
    )
