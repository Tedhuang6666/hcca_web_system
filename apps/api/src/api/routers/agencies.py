"""自治機關專頁路由：公開瀏覽與組織範圍維護。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.agency import AgencyEntry, AgencyProfile
from api.models.org import Org
from api.models.user import User
from api.schemas.agency import (
    AgencyEntryCreate,
    AgencyEntryOut,
    AgencyEntryUpdate,
    AgencyListItem,
    AgencyManageOut,
    AgencyProfileAdminUpdate,
    AgencyProfileCreate,
    AgencyProfileOut,
    AgencyProfileUpdate,
    AgencyPublicOut,
)
from api.services import agency as agency_svc
from api.services import audit as audit_svc
from api.services._base import apply_updates

router = APIRouter(prefix="/agencies", tags=["自治機關"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


async def _audit(
    db: AsyncSession, user: User, entity: AgencyProfile | AgencyEntry, action: str, meta: dict
) -> None:
    await audit_svc.record(
        db,
        entity_type="agency_entry" if isinstance(entity, AgencyEntry) else "agency_profile",
        entity_id=str(entity.id),
        action=action,
        actor_id=str(user.id),
        actor_email=user.email,
        meta=meta,
        summary=f"{action}「{getattr(entity, 'name', None) or getattr(entity, 'title', '')}」",
    )


async def _managed_agency(db: AsyncSession, user: User, agency_id: uuid.UUID) -> AgencyProfile:
    agency = await db.get(AgencyProfile, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="機關不存在")
    if not await agency_svc.can_manage(db, user, agency):
        raise HTTPException(status_code=403, detail="需要該機關維護組織的 agency:manage 權限")
    return agency


async def _require_site_admin(db: AsyncSession, user: User) -> None:
    if not await agency_svc.is_site_admin(db, user):
        raise HTTPException(status_code=403, detail="需要權限：site:manage")


async def _ensure_org(db: AsyncSession, org_id: uuid.UUID | None) -> None:
    if org_id is not None and await db.get(Org, org_id) is None:
        raise HTTPException(status_code=422, detail="維護組織不存在")


# --- 維護（需登入；/manage 必須在 /{slug} 之前註冊） ---------------------------------


@router.get("/manage", response_model=list[AgencyManageOut], summary="可維護的機關")
async def list_manageable(db: DbDep, user: CurrentUser) -> list[AgencyManageOut]:
    return await agency_svc.list_manageable(db, user)


@router.post(
    "/manage",
    response_model=AgencyProfileOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立機關專頁（網站管理員）",
)
async def create_agency(data: AgencyProfileCreate, db: DbDep, user: CurrentUser) -> AgencyProfile:
    await _require_site_admin(db, user)
    await _ensure_org(db, data.org_id)
    agency = AgencyProfile(**data.model_dump())
    db.add(agency)
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="機關 slug 已存在") from e
    await _audit(db, user, agency, "agency.create", data.model_dump(mode="json"))
    return agency


@router.patch("/manage/{agency_id}", response_model=AgencyProfileOut, summary="更新機關介紹")
async def update_agency(
    agency_id: uuid.UUID, data: AgencyProfileUpdate, db: DbDep, user: CurrentUser
) -> AgencyProfile:
    agency = await _managed_agency(db, user, agency_id)
    payload = apply_updates(agency, data)
    await db.flush()
    await _audit(db, user, agency, "agency.update", {"fields": sorted(payload)})
    return agency


@router.patch(
    "/manage/{agency_id}/admin",
    response_model=AgencyProfileOut,
    summary="更新機關結構設定（網站管理員）",
)
async def admin_update_agency(
    agency_id: uuid.UUID, data: AgencyProfileAdminUpdate, db: DbDep, user: CurrentUser
) -> AgencyProfile:
    await _require_site_admin(db, user)
    agency = await db.get(AgencyProfile, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="機關不存在")
    await _ensure_org(db, data.org_id)
    payload = apply_updates(agency, data)
    try:
        await db.flush()
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="機關 slug 已存在") from e
    await _audit(
        db, user, agency, "agency.admin_update", data.model_dump(mode="json", include=set(payload))
    )
    return agency


@router.delete(
    "/manage/{agency_id}", status_code=status.HTTP_204_NO_CONTENT, summary="刪除機關（網站管理員）"
)
async def delete_agency(agency_id: uuid.UUID, db: DbDep, user: CurrentUser) -> None:
    await _require_site_admin(db, user)
    agency = await db.get(AgencyProfile, agency_id)
    if agency is None:
        raise HTTPException(status_code=404, detail="機關不存在")
    await _audit(db, user, agency, "agency.delete", {"slug": agency.slug})
    await db.delete(agency)


@router.get(
    "/manage/{agency_id}/entries", response_model=list[AgencyEntryOut], summary="機關公開項目"
)
async def list_entries(agency_id: uuid.UUID, db: DbDep, user: CurrentUser) -> list[AgencyEntry]:
    await _managed_agency(db, user, agency_id)
    return await agency_svc.list_entries(db, agency_id, published_only=False)


@router.post(
    "/manage/{agency_id}/entries",
    response_model=AgencyEntryOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增機關公開項目",
)
async def create_entry(
    agency_id: uuid.UUID, data: AgencyEntryCreate, db: DbDep, user: CurrentUser
) -> AgencyEntry:
    agency = await _managed_agency(db, user, agency_id)
    try:
        entry = await agency_svc.create_entry(db, agency, data)
    except agency_svc.EntryKindNotAllowed as e:
        raise HTTPException(status_code=422, detail="此機關不提供這種項目類型") from e
    await _audit(db, user, entry, "agency.entry.create", {"kind": entry.kind})
    return entry


async def _managed_entry(
    db: AsyncSession, user: User, agency_id: uuid.UUID, entry_id: uuid.UUID
) -> AgencyEntry:
    await _managed_agency(db, user, agency_id)
    entry = await db.get(AgencyEntry, entry_id)
    if entry is None or entry.agency_id != agency_id:
        raise HTTPException(status_code=404, detail="項目不存在")
    return entry


@router.patch(
    "/manage/{agency_id}/entries/{entry_id}",
    response_model=AgencyEntryOut,
    summary="更新機關公開項目",
)
async def update_entry(
    agency_id: uuid.UUID,
    entry_id: uuid.UUID,
    data: AgencyEntryUpdate,
    db: DbDep,
    user: CurrentUser,
) -> AgencyEntry:
    entry = await _managed_entry(db, user, agency_id, entry_id)
    payload = apply_updates(entry, data)
    await db.flush()
    await _audit(db, user, entry, "agency.entry.update", {"fields": sorted(payload)})
    return entry


@router.delete(
    "/manage/{agency_id}/entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除機關公開項目",
)
async def delete_entry(
    agency_id: uuid.UUID, entry_id: uuid.UUID, db: DbDep, user: CurrentUser
) -> None:
    entry = await _managed_entry(db, user, agency_id, entry_id)
    await _audit(db, user, entry, "agency.entry.delete", {"kind": entry.kind})
    await db.delete(entry)


# --- 公開 ---------------------------------------------------------------------------


@router.get("", response_model=list[AgencyListItem], summary="公開機關清單")
async def list_public(db: DbDep) -> list[AgencyProfile]:
    return await agency_svc.list_published(db)


@router.get("/{slug}", response_model=AgencyPublicOut, summary="公開機關專頁")
async def get_public(slug: str, db: DbDep) -> AgencyPublicOut:
    page = await agency_svc.get_public(db, slug)
    if page is None:
        raise HTTPException(status_code=404, detail="機關專頁不存在")
    return page
