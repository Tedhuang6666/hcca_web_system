"""推薦商家路由 - /recommended-vendors"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.recommended_vendor import (
    RecommendedVendor,
    RecommendedVendorMenu,
    RecommendedVendorProduct,
)
from api.models.user import User
from api.routers._common import or_404
from api.schemas.recommended_vendor import (
    RecommendedVendorCategoryCreate,
    RecommendedVendorCategoryOut,
    RecommendedVendorCategoryUpdate,
    RecommendedVendorCreate,
    RecommendedVendorListItem,
    RecommendedVendorMenuCreate,
    RecommendedVendorMenuOut,
    RecommendedVendorMenuUpdate,
    RecommendedVendorOut,
    RecommendedVendorProductCreate,
    RecommendedVendorProductOut,
    RecommendedVendorProductUpdate,
    RecommendedVendorUpdate,
)
from api.services import audit as audit_svc
from api.services import recommended_vendor as vendor_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/recommended-vendors", tags=["推薦商家"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.RECOMMENDED_VENDOR_MANAGE))]


def _list_item(vendor: RecommendedVendor) -> RecommendedVendorListItem:
    item = RecommendedVendorListItem.model_validate(vendor)
    item.category = vendor.vendor_category.name if vendor.vendor_category else vendor.category
    item.category_id = vendor.category_id
    item.hygiene_verified = vendor_svc.hygiene_verified(vendor)
    item.product_count = sum(1 for product in vendor.products if product.is_active)
    return item


def _vendor_out(vendor: RecommendedVendor, *, include_internal: bool) -> RecommendedVendorOut:
    item = RecommendedVendorOut.model_validate(vendor)
    item.category = vendor.vendor_category.name if vendor.vendor_category else vendor.category
    item.category_id = vendor.category_id
    item.hygiene_verified = vendor_svc.hygiene_verified(vendor)
    item.products = [
        RecommendedVendorProductOut.model_validate(product)
        for product in vendor.products
        if include_internal or product.is_active
    ]
    if not include_internal:
        item.internal_note = None
    item.menus = []
    for menu in vendor.menus:
        if include_internal or menu.is_active:
            menu_out = RecommendedVendorMenuOut.model_validate(menu)
            if menu.storage_key:
                menu_out.url = f"/recommended-vendors/menus/{menu.id}/file"
            item.menus.append(menu_out)
    return item


async def _vendor_or_404(db: AsyncSession, vendor_id: uuid.UUID) -> RecommendedVendor:
    return or_404(await vendor_svc.get_vendor(db, vendor_id), "找不到此推薦商家")


async def _product_or_404(db: AsyncSession, product_id: uuid.UUID) -> RecommendedVendorProduct:
    return or_404(await vendor_svc.get_product(db, product_id), "找不到此菜單或商品")


async def _menu_or_404(db: AsyncSession, menu_id: uuid.UUID) -> RecommendedVendorMenu:
    return or_404(await vendor_svc.get_menu(db, menu_id), "找不到此菜單")


@router.get(
    "/categories", response_model=list[RecommendedVendorCategoryOut], summary="列出推薦商家分類"
)
async def list_public_categories(db: DbDep) -> list[RecommendedVendorCategoryOut]:
    return [
        RecommendedVendorCategoryOut.model_validate(category)
        for category in await vendor_svc.list_categories(db, active_only=True)
    ]


@router.get(
    "/admin/categories",
    response_model=list[RecommendedVendorCategoryOut],
    summary="管理端列出推薦商家分類",
)
async def admin_list_categories(db: DbDep, _: ManagerUser) -> list[RecommendedVendorCategoryOut]:
    return [
        RecommendedVendorCategoryOut.model_validate(category)
        for category in await vendor_svc.list_categories(db)
    ]


@router.post(
    "/admin/categories",
    response_model=RecommendedVendorCategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立推薦商家分類",
)
async def admin_create_category(
    body: RecommendedVendorCategoryCreate, db: DbDep, _: ManagerUser
) -> RecommendedVendorCategoryOut:
    return RecommendedVendorCategoryOut.model_validate(await vendor_svc.create_category(db, body))


@router.patch(
    "/admin/categories/{category_id}",
    response_model=RecommendedVendorCategoryOut,
    summary="更新推薦商家分類",
)
async def admin_update_category(
    category_id: uuid.UUID,
    body: RecommendedVendorCategoryUpdate,
    db: DbDep,
    _: ManagerUser,
) -> RecommendedVendorCategoryOut:
    category = await vendor_svc.get_category(db, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商家分類")
    return RecommendedVendorCategoryOut.model_validate(
        await vendor_svc.update_category(db, category, body)
    )


@router.get(
    "/menus/{menu_id}/file",
    summary="預覽推薦商家菜單檔案",
    response_model=None,
)
async def preview_public_menu(menu_id: uuid.UUID, db: DbDep) -> FileResponse | RedirectResponse:
    menu = await _menu_or_404(db, menu_id)
    vendor = await _vendor_or_404(db, menu.vendor_id)
    if (
        not menu.is_active
        or vendor.status != "active"
        or not vendor.is_active
        or not vendor_svc.hygiene_verified(vendor)
        or not menu.storage_key
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此菜單")
    storage = get_storage()
    local = storage.local_path(menu.storage_key)
    if local is not None:
        if not local.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="菜單檔案不存在")
        return FileResponse(str(local), media_type=menu.content_type or "application/octet-stream")
    return RedirectResponse(await storage.get_url(menu.storage_key, disposition="inline"))


@router.get("", response_model=list[RecommendedVendorListItem], summary="列出推薦商家")
async def list_public_vendors(
    db: DbDep,
    keyword: str | None = Query(None, max_length=100),
    category_id: uuid.UUID | None = Query(None),
    map_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[RecommendedVendorListItem]:
    vendors = await vendor_svc.list_vendors(
        db,
        keyword=keyword,
        category_id=category_id,
        map_only=map_only,
        limit=limit,
        offset=offset,
    )
    return [_list_item(vendor) for vendor in vendors]


@router.get("/{vendor_id}", response_model=RecommendedVendorOut, summary="取得推薦商家詳情")
async def get_public_vendor(vendor_id: uuid.UUID, db: DbDep) -> RecommendedVendorOut:
    vendor = await _vendor_or_404(db, vendor_id)
    if vendor.status != "active" or not vendor.is_active or not vendor_svc.hygiene_verified(vendor):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此推薦商家")
    return _vendor_out(vendor, include_internal=False)


@router.get(
    "/admin/vendors",
    response_model=list[RecommendedVendorListItem],
    summary="管理端列出推薦商家",
)
async def admin_list_vendors(
    db: DbDep,
    _: ManagerUser,
    keyword: str | None = Query(None, max_length=100),
    include_inactive: bool = Query(True),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[RecommendedVendorListItem]:
    vendors = await vendor_svc.list_vendors(
        db,
        include_inactive=include_inactive,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )
    return [_list_item(vendor) for vendor in vendors]


@router.post(
    "/admin/vendors",
    response_model=RecommendedVendorOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立推薦商家",
)
async def admin_create_vendor(
    body: RecommendedVendorCreate, db: DbDep, user: ManagerUser
) -> RecommendedVendorOut:
    vendor = await vendor_svc.create_vendor(db, body, user.id)
    await audit_svc.record(
        db,
        entity_type="recommended_vendor",
        entity_id=str(vendor.id),
        action="recommended_vendor.create",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"建立推薦商家「{vendor.name}」",
    )
    return _vendor_out(vendor, include_internal=True)


@router.get(
    "/admin/vendors/{vendor_id}",
    response_model=RecommendedVendorOut,
    summary="管理端取得推薦商家詳情",
)
async def admin_get_vendor(vendor_id: uuid.UUID, db: DbDep, _: ManagerUser) -> RecommendedVendorOut:
    return _vendor_out(await _vendor_or_404(db, vendor_id), include_internal=True)


@router.patch(
    "/admin/vendors/{vendor_id}",
    response_model=RecommendedVendorOut,
    summary="更新推薦商家",
)
async def admin_update_vendor(
    vendor_id: uuid.UUID, body: RecommendedVendorUpdate, db: DbDep, user: ManagerUser
) -> RecommendedVendorOut:
    vendor = await vendor_svc.update_vendor(db, await _vendor_or_404(db, vendor_id), body)
    await audit_svc.record(
        db,
        entity_type="recommended_vendor",
        entity_id=str(vendor.id),
        action="recommended_vendor.update",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"更新推薦商家「{vendor.name}」",
    )
    return _vendor_out(vendor, include_internal=True)


@router.delete(
    "/admin/vendors/{vendor_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="封存推薦商家",
)
async def admin_archive_vendor(vendor_id: uuid.UUID, db: DbDep, user: ManagerUser) -> None:
    vendor = await _vendor_or_404(db, vendor_id)
    await vendor_svc.delete_vendor(db, vendor)
    await audit_svc.record(
        db,
        entity_type="recommended_vendor",
        entity_id=str(vendor.id),
        action="recommended_vendor.archive",
        actor_id=str(user.id),
        actor_email=user.email,
        summary=f"封存推薦商家「{vendor.name}」",
    )


@router.post(
    "/admin/vendors/{vendor_id}/products",
    response_model=RecommendedVendorProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增菜單或商品",
)
async def admin_create_product(
    vendor_id: uuid.UUID, body: RecommendedVendorProductCreate, db: DbDep, _: ManagerUser
) -> RecommendedVendorProductOut:
    product = await vendor_svc.create_product(db, await _vendor_or_404(db, vendor_id), body)
    return RecommendedVendorProductOut.model_validate(product)


@router.patch(
    "/admin/products/{product_id}",
    response_model=RecommendedVendorProductOut,
    summary="更新菜單或商品",
)
async def admin_update_product(
    product_id: uuid.UUID,
    body: RecommendedVendorProductUpdate,
    db: DbDep,
    _: ManagerUser,
) -> RecommendedVendorProductOut:
    product = await vendor_svc.update_product(db, await _product_or_404(db, product_id), body)
    return RecommendedVendorProductOut.model_validate(product)


@router.delete(
    "/admin/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除菜單或商品",
)
async def admin_delete_product(product_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    await vendor_svc.delete_product(db, await _product_or_404(db, product_id))


@router.post(
    "/admin/vendors/{vendor_id}/menus",
    response_model=RecommendedVendorMenuOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增外部連結菜單",
)
async def admin_create_menu(
    vendor_id: uuid.UUID,
    body: RecommendedVendorMenuCreate,
    db: DbDep,
    _: ManagerUser,
) -> RecommendedVendorMenuOut:
    try:
        menu = await vendor_svc.create_menu(db, await _vendor_or_404(db, vendor_id), body)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return RecommendedVendorMenuOut.model_validate(menu)


@router.post(
    "/admin/vendors/{vendor_id}/menus/upload",
    response_model=RecommendedVendorMenuOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳推薦商家菜單圖片或 PDF",
)
async def admin_upload_menu(
    vendor_id: uuid.UUID,
    db: DbDep,
    _: ManagerUser,
    file: UploadFile = File(...),
    title: str | None = Query(None, max_length=200),
    sort_order: int = Query(0),
) -> RecommendedVendorMenuOut:
    vendor = await _vendor_or_404(db, vendor_id)
    allowed_types = frozenset(
        {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"}
    )
    try:
        stored = await get_storage().save(
            file,
            prefix=f"recommended-vendors/{vendor.id}",
            allowed_content_types=allowed_types,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    kind = "pdf" if stored.content_type == "application/pdf" else "image"
    menu = RecommendedVendorMenu(
        vendor_id=vendor.id,
        title=title or stored.filename,
        kind=kind,
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
        sort_order=sort_order,
    )
    db.add(menu)
    await db.flush()
    return RecommendedVendorMenuOut(
        **RecommendedVendorMenuOut.model_validate(menu).model_dump(),
        url=f"/recommended-vendors/menus/{menu.id}/file",
    )


@router.patch(
    "/admin/menus/{menu_id}",
    response_model=RecommendedVendorMenuOut,
    summary="更新推薦商家菜單",
)
async def admin_update_menu(
    menu_id: uuid.UUID,
    body: RecommendedVendorMenuUpdate,
    db: DbDep,
    _: ManagerUser,
) -> RecommendedVendorMenuOut:
    menu = await vendor_svc.update_menu(db, await _menu_or_404(db, menu_id), body)
    return RecommendedVendorMenuOut.model_validate(menu)


@router.delete(
    "/admin/menus/{menu_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除推薦商家菜單",
)
async def admin_delete_menu(menu_id: uuid.UUID, db: DbDep, _: ManagerUser) -> None:
    menu = await _menu_or_404(db, menu_id)
    storage_key = await vendor_svc.delete_menu(db, menu)
    if storage_key:
        await get_storage().delete(storage_key)
