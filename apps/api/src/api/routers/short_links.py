"""班聯短網址管理與公開解析 API。"""

from __future__ import annotations

from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.short_link import (
    ShortLinkCreate,
    ShortLinkOut,
    ShortLinkResolveOut,
    ShortLinkUpdate,
)
from api.services import audit as audit_svc
from api.services import short_link as short_link_svc

router = APIRouter(prefix="/short-links", tags=["經營工具 / 短網址"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
ManageShortLinks = Depends(require_permission(PermissionCode.QR_CODE_MANAGE))


@router.get("", response_model=list[ShortLinkOut], dependencies=[ManageShortLinks])
async def list_short_links(db: DbDep) -> list[ShortLinkOut]:
    return await short_link_svc.list_short_links(db)


@router.post(
    "",
    response_model=ShortLinkOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[ManageShortLinks],
)
async def create_short_link(
    data: ShortLinkCreate, db: DbDep, current_user: CurrentUser
) -> ShortLinkOut:
    try:
        short_link = await short_link_svc.create_short_link(db, data)
    except short_link_svc.ShortLinkConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="short_link",
        entity_id=str(short_link.id),
        action="short_link.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"slug": short_link.slug, "target_host": urlsplit(short_link.target_url).hostname},
        summary=f"建立班聯短網址「{short_link.slug}」",
    )
    await db.commit()
    await db.refresh(short_link)
    return short_link


@router.patch(
    "/{link_id}",
    response_model=ShortLinkOut,
    dependencies=[ManageShortLinks],
)
async def update_short_link(
    link_id: UUID, data: ShortLinkUpdate, db: DbDep, current_user: CurrentUser
) -> ShortLinkOut:
    try:
        short_link = await short_link_svc.update_short_link(db, link_id, data)
    except short_link_svc.ShortLinkNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="短網址不存在") from exc
    await audit_svc.record(
        db,
        entity_type="short_link",
        entity_id=str(short_link.id),
        action="short_link.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "slug": short_link.slug,
            "target_host": urlsplit(short_link.target_url).hostname,
            "is_active": short_link.is_active,
            "changed_fields": sorted(data.model_fields_set),
        },
        summary=f"更新班聯短網址「{short_link.slug}」",
    )
    await db.commit()
    await db.refresh(short_link)
    return short_link


@router.get("/resolve/{slug}", response_model=ShortLinkResolveOut, summary="解析公開短網址")
async def resolve_short_link(slug: str, db: DbDep) -> ShortLinkResolveOut:
    try:
        short_link = await short_link_svc.resolve_short_link(db, slug)
    except short_link_svc.ShortLinkSlugUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="短網址不存在") from exc
    return ShortLinkResolveOut(target_url=short_link.target_url)
