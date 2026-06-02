"""公開官網與 Linktree 路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.site import PublicLinkCategory, PublicSitePage
from api.models.user import User
from api.schemas.site import (
    PublicLinkCategoryCreate,
    PublicLinkCategoryOut,
    PublicLinkCategoryUpdate,
    PublicLinkCreate,
    PublicLinkOut,
    PublicLinkUpdate,
    PublicOfficerCandidateOut,
    PublicOfficerOut,
    PublicOfficerProfileCreate,
    PublicOfficerProfileOut,
    PublicOfficerProfileUpdate,
    PublicSiteBundleOut,
    PublicSitePageCreate,
    PublicSitePageOut,
    PublicSitePageUpdate,
    PublicSiteSettingsOut,
    PublicSiteSettingsUpdate,
)
from api.services import audit as audit_svc
from api.services import site as site_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/site", tags=["公開官網"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
SiteAdminDep = Depends(require_any(PermissionCode.SITE_MANAGE, PermissionCode.ADMIN_ALL))


@router.get("/public", response_model=PublicSiteBundleOut, summary="公開官網首頁資料")
async def get_public_site(db: DbDep) -> PublicSiteBundleOut:
    return PublicSiteBundleOut(
        settings=PublicSiteSettingsOut.model_validate(await site_svc.get_settings(db)),
        links=[PublicLinkOut.model_validate(item) for item in await site_svc.list_links(db, True)],
        link_categories=[
            PublicLinkCategoryOut.model_validate(item)
            for item in await site_svc.list_link_categories(db, True)
        ],
        featured_officers=await site_svc.list_officers(db, active_only=True, featured_only=True),
        nav_pages=[
            PublicSitePageOut.model_validate(item)
            for item in await site_svc.list_pages(db, published_only=True, nav_only=True)
        ],
    )


@router.get("/links", response_model=list[PublicLinkOut], summary="公開 Linktree 連結")
async def list_public_links(db: DbDep) -> list:
    return [PublicLinkOut.model_validate(item) for item in await site_svc.list_links(db, True)]


@router.get("/link-categories", response_model=list[PublicLinkCategoryOut], summary="公開連結分類")
async def list_public_link_categories(db: DbDep) -> list:
    return [
        PublicLinkCategoryOut.model_validate(item)
        for item in await site_svc.list_link_categories(db, True)
    ]


@router.get("/officers", response_model=list[PublicOfficerOut], summary="公開幹部名單")
async def list_public_officers(
    db: DbDep,
    active_only: bool = Query(True, description="僅列出目前任期仍有效的幹部"),
) -> list[PublicOfficerOut]:
    return await site_svc.list_officers(db, active_only=active_only)


@router.get("/pages", response_model=list[PublicSitePageOut], summary="公開官網頁面清單")
async def list_public_pages(db: DbDep) -> list:
    return [
        PublicSitePageOut.model_validate(item)
        for item in await site_svc.list_pages(db, published_only=True)
    ]


@router.get("/pages/{slug}", response_model=PublicSitePageOut, summary="公開官網頁面")
async def get_public_page(slug: str, db: DbDep) -> object:
    page = await site_svc.get_page_by_slug(db, slug)
    if not page or not page.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="頁面不存在")
    return page


@router.get("/admin/settings", response_model=PublicSiteSettingsOut, dependencies=[SiteAdminDep])
async def admin_get_settings(db: DbDep, _: CurrentUser) -> object:
    return await site_svc.get_settings(db)


@router.patch("/admin/settings", response_model=PublicSiteSettingsOut, dependencies=[SiteAdminDep])
async def admin_update_settings(
    data: PublicSiteSettingsUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    settings = await site_svc.update_settings(db, data)
    await audit_svc.record(
        db,
        entity_type="public_site_settings",
        entity_id=str(settings.id),
        action="site.settings.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(exclude_unset=True, mode="json"),
        summary="更新公開官網設定",
    )
    return settings


class UploadedImageOut(BaseModel):
    url: str
    filename: str
    content_type: str
    file_size: int


_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})


@router.post(
    "/admin/images",
    response_model=UploadedImageOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[SiteAdminDep],
    summary="上傳公開官網圖片（會徽 / 封面 / 幹部頭像等），回傳可直接填入設定的 URL",
)
async def admin_upload_image(
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> UploadedImageOut:
    if (file.content_type or "") not in _IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="僅支援 JPEG / PNG / GIF / WebP 圖片",
        )
    storage = get_storage()
    try:
        stored = await storage.save(file, prefix="public-site")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return UploadedImageOut(
        url=stored.url or f"/uploads/{stored.storage_key}",
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
    )


@router.get(
    "/admin/link-categories",
    response_model=list[PublicLinkCategoryOut],
    dependencies=[SiteAdminDep],
)
async def admin_list_link_categories(db: DbDep, _: CurrentUser) -> list:
    return [
        PublicLinkCategoryOut.model_validate(i) for i in await site_svc.list_link_categories(db)
    ]


@router.post(
    "/admin/link-categories",
    response_model=PublicLinkCategoryOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[SiteAdminDep],
)
async def admin_create_link_category(
    data: PublicLinkCategoryCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    try:
        item = await site_svc.create_link_category(db, data)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="連結分類 slug 已存在") from e
    await audit_svc.record(
        db,
        entity_type="public_link_category",
        entity_id=str(item.id),
        action="site.link_category.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(mode="json"),
        summary=f"新增公開連結分類「{item.title}」",
    )
    return item


@router.patch(
    "/admin/link-categories/{category_id}",
    response_model=PublicLinkCategoryOut,
    dependencies=[SiteAdminDep],
)
async def admin_update_link_category(
    category_id: uuid.UUID,
    data: PublicLinkCategoryUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    item = await db.get(PublicLinkCategory, category_id)
    if not item:
        raise HTTPException(status_code=404, detail="連結分類不存在")
    try:
        item = await site_svc.update_link_category(db, item, data)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="連結分類 slug 已存在") from e
    await audit_svc.record(
        db,
        entity_type="public_link_category",
        entity_id=str(item.id),
        action="site.link_category.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(exclude_unset=True, mode="json"),
        summary=f"更新公開連結分類「{item.title}」",
    )
    return item


@router.delete(
    "/admin/link-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[SiteAdminDep],
)
async def admin_delete_link_category(
    category_id: uuid.UUID,
    db: DbDep,
    current_user: CurrentUser,
) -> None:
    item = await db.get(PublicLinkCategory, category_id)
    if not item:
        raise HTTPException(status_code=404, detail="連結分類不存在")
    await audit_svc.record(
        db,
        entity_type="public_link_category",
        entity_id=str(item.id),
        action="site.link_category.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"title": item.title, "slug": item.slug},
        summary=f"刪除公開連結分類「{item.title}」",
    )
    await db.delete(item)


@router.get("/admin/links", response_model=list[PublicLinkOut], dependencies=[SiteAdminDep])
async def admin_list_links(db: DbDep, _: CurrentUser) -> list:
    return [PublicLinkOut.model_validate(item) for item in await site_svc.list_links(db)]


@router.post(
    "/admin/links",
    response_model=PublicLinkOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[SiteAdminDep],
)
async def admin_create_link(
    data: PublicLinkCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    link = await site_svc.create_link(db, data)
    await audit_svc.record(
        db,
        entity_type="public_link",
        entity_id=str(link.id),
        action="site.link.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(mode="json"),
        summary=f"新增公開連結「{link.title}」",
    )
    return link


@router.patch("/admin/links/{link_id}", response_model=PublicLinkOut, dependencies=[SiteAdminDep])
async def admin_update_link(
    link_id: uuid.UUID,
    data: PublicLinkUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    link = await site_svc.get_link(db, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="連結不存在")
    link = await site_svc.update_link(db, link, data)
    await audit_svc.record(
        db,
        entity_type="public_link",
        entity_id=str(link.id),
        action="site.link.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(exclude_unset=True, mode="json"),
        summary=f"更新公開連結「{link.title}」",
    )
    return link


@router.delete(
    "/admin/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[SiteAdminDep],
)
async def admin_delete_link(link_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> None:
    link = await site_svc.get_link(db, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="連結不存在")
    await audit_svc.record(
        db,
        entity_type="public_link",
        entity_id=str(link.id),
        action="site.link.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"title": link.title, "url": link.url},
        summary=f"刪除公開連結「{link.title}」",
    )
    await db.delete(link)


@router.get(
    "/admin/officer-candidates",
    response_model=list[PublicOfficerCandidateOut],
    dependencies=[SiteAdminDep],
)
async def admin_list_officer_candidates(
    db: DbDep,
    _: CurrentUser,
    active_only: bool = Query(True),
) -> list[PublicOfficerCandidateOut]:
    return await site_svc.list_officer_candidates(db, active_only=active_only)


@router.get(
    "/admin/officer-profiles",
    response_model=list[PublicOfficerProfileOut],
    dependencies=[SiteAdminDep],
)
async def admin_list_officer_profiles(db: DbDep, _: CurrentUser) -> list:
    return [
        PublicOfficerProfileOut.model_validate(item)
        for item in await site_svc.list_officer_profiles(db)
    ]


@router.post(
    "/admin/officer-profiles",
    response_model=PublicOfficerProfileOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[SiteAdminDep],
)
async def admin_create_officer_profile(
    data: PublicOfficerProfileCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    try:
        profile = await site_svc.create_officer_profile(db, data)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="此任期已建立公開幹部設定") from e
    await audit_svc.record(
        db,
        entity_type="public_officer_profile",
        entity_id=str(profile.id),
        action="site.officer_profile.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(mode="json"),
        summary="新增公開幹部設定",
    )
    return profile


@router.patch(
    "/admin/officer-profiles/{profile_id}",
    response_model=PublicOfficerProfileOut,
    dependencies=[SiteAdminDep],
)
async def admin_update_officer_profile(
    profile_id: uuid.UUID,
    data: PublicOfficerProfileUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    profile = await site_svc.get_officer_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="公開幹部設定不存在")
    try:
        profile = await site_svc.update_officer_profile(db, profile, data)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="此任期已建立公開幹部設定") from e
    await audit_svc.record(
        db,
        entity_type="public_officer_profile",
        entity_id=str(profile.id),
        action="site.officer_profile.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(exclude_unset=True, mode="json"),
        summary="更新公開幹部設定",
    )
    return profile


@router.delete(
    "/admin/officer-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[SiteAdminDep],
)
async def admin_delete_officer_profile(
    profile_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> None:
    profile = await site_svc.get_officer_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="公開幹部設定不存在")
    await audit_svc.record(
        db,
        entity_type="public_officer_profile",
        entity_id=str(profile.id),
        action="site.officer_profile.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"user_position_id": str(profile.user_position_id)},
        summary="刪除公開幹部設定",
    )
    await db.delete(profile)


@router.get("/admin/pages", response_model=list[PublicSitePageOut], dependencies=[SiteAdminDep])
async def admin_list_pages(db: DbDep, _: CurrentUser) -> list:
    return [PublicSitePageOut.model_validate(item) for item in await site_svc.list_pages(db)]


@router.post(
    "/admin/pages",
    response_model=PublicSitePageOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[SiteAdminDep],
)
async def admin_create_page(
    data: PublicSitePageCreate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    try:
        page = await site_svc.create_page(db, data)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="頁面 slug 已存在") from e
    await audit_svc.record(
        db,
        entity_type="public_site_page",
        entity_id=str(page.id),
        action="site.page.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(mode="json"),
        summary=f"新增公開頁面「{page.title}」",
    )
    return page


@router.patch(
    "/admin/pages/{page_id}",
    response_model=PublicSitePageOut,
    dependencies=[SiteAdminDep],
)
async def admin_update_page(
    page_id: uuid.UUID,
    data: PublicSitePageUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> object:
    page = await db.get(PublicSitePage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="頁面不存在")
    try:
        page = await site_svc.update_page(db, page, data)
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="頁面 slug 已存在") from e
    await audit_svc.record(
        db,
        entity_type="public_site_page",
        entity_id=str(page.id),
        action="site.page.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=data.model_dump(exclude_unset=True, mode="json"),
        summary=f"更新公開頁面「{page.title}」",
    )
    return page


@router.delete(
    "/admin/pages/{page_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[SiteAdminDep],
)
async def admin_delete_page(page_id: uuid.UUID, db: DbDep, current_user: CurrentUser) -> None:
    page = await db.get(PublicSitePage, page_id)
    if not page:
        raise HTTPException(status_code=404, detail="頁面不存在")
    await audit_svc.record(
        db,
        entity_type="public_site_page",
        entity_id=str(page.id),
        action="site.page.delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"title": page.title, "slug": page.slug},
        summary=f"刪除公開頁面「{page.title}」",
    )
    await db.delete(page)
