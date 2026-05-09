"""公告系統路由 - /announcements"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.announcement import (
    AnnouncementCreate,
    AnnouncementListItem,
    AnnouncementMediaOut,
    AnnouncementOut,
    AnnouncementStatsOut,
    AnnouncementUpdate,
)
from api.services import announcement as ann_svc
from api.services import audit as audit_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/announcements", tags=["公告系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


def _enrich(ann: object, storage_url_fn: object = None) -> AnnouncementOut:
    """ORM → schema，補充 author_name 與 media URL。"""
    out = AnnouncementOut.model_validate(ann)
    author = getattr(ann, "author", None)
    if author:
        out.author_name = getattr(author, "display_name", "")
    for m, media_orm in zip(out.media, getattr(ann, "media", []), strict=False):
        m.url = f"/uploads/{media_orm.storage_key}"
    return out


# ── 公開端點（無需登入） ───────────────────────────────────────────────────────


@router.get(
    "/active-urgent", response_model=AnnouncementOut | None, summary="取得目前有效的緊急公告"
)
async def get_active_urgent(db: DbDep) -> AnnouncementOut | None:
    """回傳目前有效的緊急公告（首頁 Popup 使用）；無則回傳 null。"""
    ann = await ann_svc.get_active_urgent(db)
    if ann is None:
        return None
    return _enrich(ann)


@router.get("", response_model=list[AnnouncementListItem], summary="列出已發布公告")
async def list_announcements(
    db: DbDep,
    org_id: uuid.UUID | None = Query(None, description="篩選特定組織的公告（None=全站）"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
) -> list[AnnouncementListItem]:
    """列出已發布公告，依發布時間倒序排列。"""
    anns = await ann_svc.list_announcements(
        db, org_id=org_id, published_only=True, skip=skip, limit=limit
    )
    result = []
    for ann in anns:
        item = AnnouncementListItem.model_validate(ann)
        author = getattr(ann, "author", None)
        if author:
            item.author_name = getattr(author, "display_name", "")
        result.append(item)
    return result


# ── 需要登入 + 權限的端點 ──────────────────────────────────────────────────────


@router.get(
    "/admin/all", response_model=list[AnnouncementListItem], summary="列出所有公告（含草稿）"
)
async def list_all_announcements(
    db: DbDep,
    _: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_CREATE))],
    org_id: uuid.UUID | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> list[AnnouncementListItem]:
    """管理員用：列出所有公告（含草稿），需 announcement:create 權限。"""
    anns = await ann_svc.list_announcements(
        db, org_id=org_id, published_only=False, skip=skip, limit=limit
    )
    result = []
    for ann in anns:
        item = AnnouncementListItem.model_validate(ann)
        author = getattr(ann, "author", None)
        if author:
            item.author_name = getattr(author, "display_name", "")
        result.append(item)
    return result


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


@router.get("/{ann_id}", response_model=AnnouncementOut, summary="取得公告詳情")
async def get_announcement(
    ann_id: uuid.UUID, db: DbDep, current_user: OptionalUser
) -> AnnouncementOut:
    ann = await ann_svc.get(db, ann_id)
    if current_user is not None:
        await ann_svc.record_read(db, ann_id, current_user.id)
    return _enrich(ann)


@router.get(
    "/{ann_id}/stats",
    response_model=AnnouncementStatsOut,
    summary="取得公告閱讀統計（需 announcement:view_stats）",
)
async def get_announcement_stats(
    ann_id: uuid.UUID,
    db: DbDep,
    _: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_VIEW_STATS))],
) -> AnnouncementStatsOut:
    return await ann_svc.get_stats(db, ann_id)


@router.post(
    "",
    response_model=AnnouncementOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立公告（需 announcement:create）",
)
async def create_announcement(
    body: AnnouncementCreate,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_CREATE))],
) -> AnnouncementOut:
    ann = await ann_svc.create(db, user, body)
    await audit_svc.record(
        db,
        entity_type="announcement",
        entity_id=str(ann.id),
        action="announcement.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"title": ann.title, "org_id": str(ann.org_id) if ann.org_id else None},
        summary=f"建立公告「{ann.title}」",
    )
    return _enrich(ann)


@router.patch(
    "/{ann_id}",
    response_model=AnnouncementOut,
    summary="更新公告（需 announcement:edit）",
)
async def update_announcement(
    ann_id: uuid.UUID,
    body: AnnouncementUpdate,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_EDIT))],
) -> AnnouncementOut:
    before = await ann_svc.get(db, ann_id)
    before_meta = {
        "title": before.title,
        "is_published": before.is_published,
        "is_urgent": before.is_urgent,
        "urgent_until": before.urgent_until.isoformat() if before.urgent_until else None,
    }
    ann = await ann_svc.update(db, ann_id, body, user)
    await audit_svc.record(
        db,
        entity_type="announcement",
        entity_id=str(ann.id),
        action="announcement.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "before": before_meta,
            "after": {
                "title": ann.title,
                "is_published": ann.is_published,
                "is_urgent": ann.is_urgent,
                "urgent_until": ann.urgent_until.isoformat() if ann.urgent_until else None,
            },
        },
        summary=f"更新公告「{ann.title}」",
    )
    return _enrich(ann)


@router.post(
    "/{ann_id}/publish",
    response_model=AnnouncementOut,
    summary="發布公告（需 announcement:publish）",
)
async def publish_announcement(
    ann_id: uuid.UUID,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_PUBLISH))],
) -> AnnouncementOut:
    ann = await ann_svc.publish(db, ann_id)
    await audit_svc.record(
        db,
        entity_type="announcement",
        entity_id=str(ann.id),
        action="announcement.publish",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"published_at": ann.published_at.isoformat() if ann.published_at else None},
        summary=f"發布公告「{ann.title}」",
    )
    return _enrich(ann)


@router.post(
    "/{ann_id}/unpublish",
    response_model=AnnouncementOut,
    summary="取消發布公告（需 announcement:publish）",
)
async def unpublish_announcement(
    ann_id: uuid.UUID,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_PUBLISH))],
) -> AnnouncementOut:
    ann = await ann_svc.unpublish(db, ann_id)
    await audit_svc.record(
        db,
        entity_type="announcement",
        entity_id=str(ann.id),
        action="announcement.unpublish",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"published_at": ann.published_at.isoformat() if ann.published_at else None},
        summary=f"取消發布公告「{ann.title}」",
    )
    return _enrich(ann)


@router.patch(
    "/{ann_id}/urgent",
    response_model=AnnouncementOut,
    summary="設定緊急狀態（需 announcement:set_urgent）",
)
async def set_urgent(
    ann_id: uuid.UUID,
    body: AnnouncementUpdate,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_SET_URGENT))],
) -> AnnouncementOut:
    """僅允許修改 is_urgent 與 urgent_until 欄位。"""
    filtered = AnnouncementUpdate(is_urgent=body.is_urgent, urgent_until=body.urgent_until)
    ann = await ann_svc.update(db, ann_id, filtered, user)
    await audit_svc.record(
        db,
        entity_type="announcement",
        entity_id=str(ann.id),
        action="announcement.set_urgent",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "is_urgent": ann.is_urgent,
            "urgent_until": ann.urgent_until.isoformat() if ann.urgent_until else None,
        },
        summary=f"設定公告「{ann.title}」緊急狀態",
    )
    return _enrich(ann)


@router.delete(
    "/{ann_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除公告（需 announcement:edit）",
)
async def delete_announcement(
    ann_id: uuid.UUID,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_EDIT))],
) -> None:
    ann = await ann_svc.get(db, ann_id)
    await audit_svc.record(
        db,
        entity_type="announcement",
        entity_id=str(ann.id),
        action="announcement.delete",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"title": ann.title, "org_id": str(ann.org_id) if ann.org_id else None},
        summary=f"刪除公告「{ann.title}」",
    )
    await ann_svc.delete(db, ann_id)


# ── 媒體管理 ───────────────────────────────────────────────────────────────────


@router.post(
    "/{ann_id}/media",
    response_model=AnnouncementMediaOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳公告媒體（需 announcement:media_manage）",
)
async def upload_media(
    ann_id: uuid.UUID,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_MEDIA_MANAGE))],
    file: UploadFile = File(...),
) -> AnnouncementMediaOut:
    storage = get_storage()
    media = await ann_svc.upload_media(db, ann_id, file, storage)
    await audit_svc.record(
        db,
        entity_type="announcement_media",
        entity_id=str(media.id),
        action="announcement.media_upload",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"announcement_id": str(ann_id), "filename": media.filename},
        summary=f"上傳公告媒體「{media.filename}」",
    )
    out = AnnouncementMediaOut.model_validate(media)
    out.url = f"/uploads/{media.storage_key}"
    return out


@router.delete(
    "/{ann_id}/media/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除公告媒體（需 announcement:media_manage）",
)
async def delete_media(
    ann_id: uuid.UUID,
    media_id: uuid.UUID,
    db: DbDep,
    user: Annotated[User, Depends(require_permission(PermissionCode.ANNOUNCEMENT_MEDIA_MANAGE))],
) -> None:
    storage = get_storage()
    await audit_svc.record(
        db,
        entity_type="announcement_media",
        entity_id=str(media_id),
        action="announcement.media_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"announcement_id": str(ann_id)},
        summary="刪除公告媒體",
    )
    await ann_svc.delete_media(db, ann_id, media_id, storage)
