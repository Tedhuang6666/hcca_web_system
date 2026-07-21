"""推薦商家路由 - /recommended-vendors"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.recommended_vendor import RecommendedVendor, RecommendedVendorProduct
from api.models.user import User
from api.routers._common import or_404
from api.schemas.recommended_vendor import (
    RecommendedVendorCreate,
    RecommendedVendorListItem,
    RecommendedVendorOut,
    RecommendedVendorProductCreate,
    RecommendedVendorProductOut,
    RecommendedVendorProductUpdate,
    RecommendedVendorUpdate,
)
from api.services import audit as audit_svc
from api.services import recommended_vendor as vendor_svc

router = APIRouter(prefix="/recommended-vendors", tags=["推薦商家"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
ManagerUser = Annotated[User, Depends(require_permission(PermissionCode.RECOMMENDED_VENDOR_MANAGE))]


def _list_item(vendor: RecommendedVendor) -> RecommendedVendorListItem:
    item = RecommendedVendorListItem.model_validate(vendor)
    item.hygiene_verified = vendor_svc.hygiene_verified(vendor)
    item.product_count = sum(1 for product in vendor.products if product.is_active)
    return item


def _vendor_out(vendor: RecommendedVendor, *, include_internal: bool) -> RecommendedVendorOut:
    item = RecommendedVendorOut.model_validate(vendor)
    item.hygiene_verified = vendor_svc.hygiene_verified(vendor)
    item.products = [
        RecommendedVendorProductOut.model_validate(product)
        for product in vendor.products
        if include_internal or product.is_active
    ]
    if not include_internal:
        item.internal_note = None
    return item


async def _vendor_or_404(db: AsyncSession, vendor_id: uuid.UUID) -> RecommendedVendor:
    return or_404(await vendor_svc.get_vendor(db, vendor_id), "找不到此推薦商家")


async def _product_or_404(db: AsyncSession, product_id: uuid.UUID) -> RecommendedVendorProduct:
    return or_404(await vendor_svc.get_product(db, product_id), "找不到此菜單或商品")


@router.get("", response_model=list[RecommendedVendorListItem], summary="列出推薦商家")
async def list_public_vendors(
    db: DbDep,
    keyword: str | None = Query(None, max_length=100),
    category: str | None = Query(None, max_length=80),
    map_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[RecommendedVendorListItem]:
    vendors = await vendor_svc.list_vendors(
        db,
        keyword=keyword,
        category=category,
        map_only=map_only,
        limit=limit,
        offset=offset,
    )
    return [_list_item(vendor) for vendor in vendors]


@router.get("/{vendor_id}", response_model=RecommendedVendorOut, summary="取得推薦商家詳情")
async def get_public_vendor(vendor_id: uuid.UUID, db: DbDep) -> RecommendedVendorOut:
    vendor = await _vendor_or_404(db, vendor_id)
    if (
        vendor.status != "active"
        or not vendor.is_active
        or not vendor_svc.hygiene_verified(vendor)
    ):
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
