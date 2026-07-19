"""公告系統業務邏輯"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql.elements import ColumnElement

from api.models.announcement import (
    Announcement,
    AnnouncementAudience,
    AnnouncementMedia,
    AnnouncementRead,
    announcement_audience_orgs,
    announcement_audience_users,
)
from api.models.org import Org
from api.models.user import User
from api.schemas.announcement import AnnouncementCreate, AnnouncementStatsOut, AnnouncementUpdate
from api.services.storage import StorageBackend

_MEDIA_ALLOWED_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
_MEDIA_MAX_SIZE = 10 * 1024 * 1024  # 10 MB


@dataclass(frozen=True)
class ViewerScope:
    """檢視者的可見範圍判定依據（由 router 層組裝）。"""

    user_id: uuid.UUID | None = None
    org_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    is_school: bool = False


def _audience_clause(scope: ViewerScope) -> ColumnElement[bool]:
    """組裝公告對象的 SQL 可見性條件（OR 邏輯）。"""
    conds: list[ColumnElement[bool]] = [
        Announcement.audience_type == AnnouncementAudience.ALL.value
    ]
    if scope.is_school:
        conds.append(Announcement.audience_type == AnnouncementAudience.SCHOOL.value)
    if scope.org_ids:
        conds.append(
            and_(
                Announcement.audience_type == AnnouncementAudience.ORGS.value,
                Announcement.id.in_(
                    select(announcement_audience_orgs.c.announcement_id).where(
                        announcement_audience_orgs.c.org_id.in_(scope.org_ids)
                    )
                ),
            )
        )
    if scope.user_id is not None:
        conds.append(
            and_(
                Announcement.audience_type == AnnouncementAudience.MEMBERS.value,
                Announcement.id.in_(
                    select(announcement_audience_users.c.announcement_id).where(
                        announcement_audience_users.c.user_id == scope.user_id
                    )
                ),
            )
        )
        # 作者一律看得到自己發布的公告
        conds.append(Announcement.author_id == scope.user_id)
    return or_(*conds)


def is_visible_to(ann: Announcement, scope: ViewerScope) -> bool:
    """判斷單一公告是否落在檢視者的可見範圍內（detail 端點用）。"""
    if scope.user_id is not None and ann.author_id == scope.user_id:
        return True
    if ann.audience_type == AnnouncementAudience.ALL.value:
        return True
    if ann.audience_type == AnnouncementAudience.SCHOOL.value:
        return scope.is_school
    if ann.audience_type == AnnouncementAudience.ORGS.value:
        return any(o.id in scope.org_ids for o in ann.audience_orgs)
    if ann.audience_type == AnnouncementAudience.MEMBERS.value:
        return scope.user_id is not None and any(u.id == scope.user_id for u in ann.audience_users)
    return False


async def _resolve_audience(
    db: AsyncSession,
    audience_type: AnnouncementAudience,
    org_ids: list[uuid.UUID],
    user_ids: list[uuid.UUID],
) -> tuple[list[Org], list[User]]:
    """依對象類型查出並驗證目標組織/成員。"""
    if audience_type == AnnouncementAudience.ORGS:
        if not org_ids:
            raise ValueError("對象為特定組織時，至少需選擇一個組織")
        result = await db.execute(select(Org).where(Org.id.in_(org_ids)))
        orgs = list(result.scalars().all())
        if len(orgs) != len(set(org_ids)):
            raise ValueError("部分指定的組織不存在")
        return orgs, []
    if audience_type == AnnouncementAudience.MEMBERS:
        if not user_ids:
            raise ValueError("對象為特定成員時，至少需選擇一位成員")
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = list(result.scalars().all())
        if len(users) != len(set(user_ids)):
            raise ValueError("部分指定的成員不存在")
        return [], users
    # ALL / SCHOOL 不需要明細，並清空舊有關聯
    return [], []


async def _get_or_404(ann_id: uuid.UUID, db: AsyncSession) -> Announcement:
    result = await db.execute(
        select(Announcement)
        .where(Announcement.id == ann_id)
        .options(selectinload(Announcement.media), selectinload(Announcement.author))
    )
    ann = result.scalar_one_or_none()
    if ann is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="公告不存在")
    return ann


async def create(
    db: AsyncSession,
    author: User,
    body: AnnouncementCreate,
) -> Announcement:
    orgs, users = await _resolve_audience(
        db, body.audience_type, body.audience_org_ids, body.audience_user_ids
    )
    ann = Announcement(
        title=body.title,
        content=body.content,
        is_urgent=body.is_urgent,
        urgent_until=body.urgent_until,
        link_url=body.link_url,
        link_label=body.link_label,
        show_on_every_visit=body.show_on_every_visit,
        org_id=body.org_id,
        activity_id=body.activity_id,
        author_id=author.id,
        audience_type=body.audience_type.value,
    )
    ann.audience_orgs = orgs
    ann.audience_users = users
    db.add(ann)
    await db.flush()
    await db.refresh(ann, ["media", "author", "audience_orgs", "audience_users"])
    return ann


async def get(db: AsyncSession, ann_id: uuid.UUID) -> Announcement:
    return await _get_or_404(ann_id, db)


async def list_announcements(
    db: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    published_only: bool = True,
    urgent_only: bool = False,
    skip: int = 0,
    limit: int = 20,
    scope: ViewerScope | None = None,
) -> list[Announcement]:
    """列出公告；傳入 scope 時依公告對象過濾可見範圍（None = 不過濾，管理端用）。"""
    q = select(Announcement).options(
        selectinload(Announcement.media), selectinload(Announcement.author)
    )
    if published_only:
        q = q.where(Announcement.is_published == True)  # noqa: E712
    if urgent_only:
        now = datetime.now(UTC)
        q = q.where(
            Announcement.is_urgent == True,  # noqa: E712
            Announcement.is_published == True,  # noqa: E712
            (Announcement.urgent_until == None) | (Announcement.urgent_until >= now),  # noqa: E711
        )
    if scope is not None:
        q = q.where(_audience_clause(scope))
    if org_id is not None:
        q = q.where(Announcement.org_id == org_id)
    if activity_id is not None:
        q = q.where(Announcement.activity_id == activity_id)
    q = q.order_by(Announcement.published_at.desc().nullslast(), Announcement.created_at.desc())
    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().all())


async def update(
    db: AsyncSession,
    ann_id: uuid.UUID,
    body: AnnouncementUpdate,
    editor: User,
) -> Announcement:
    ann = await _get_or_404(ann_id, db)
    fields = body.model_fields_set
    if body.title is not None:
        ann.title = body.title
    if body.content is not None:
        ann.content = body.content
    if body.is_urgent is not None:
        ann.is_urgent = body.is_urgent
    if "urgent_until" in fields:
        ann.urgent_until = body.urgent_until
    if "link_url" in fields:
        ann.link_url = body.link_url
        if body.link_url is None and "link_label" not in fields:
            ann.link_label = None
    if "link_label" in fields:
        ann.link_label = body.link_label
    if body.show_on_every_visit is not None:
        ann.show_on_every_visit = body.show_on_every_visit
    if "activity_id" in fields:
        ann.activity_id = body.activity_id
    if body.audience_type is not None:
        orgs, users = await _resolve_audience(
            db,
            body.audience_type,
            body.audience_org_ids or [],
            body.audience_user_ids or [],
        )
        ann.audience_type = body.audience_type.value
        ann.audience_orgs = orgs
        ann.audience_users = users
    await db.flush()
    await db.refresh(ann, ["audience_orgs", "audience_users"])
    return ann


async def publish(db: AsyncSession, ann_id: uuid.UUID) -> Announcement:
    ann = await _get_or_404(ann_id, db)
    ann.is_published = True
    if ann.published_at is None:
        ann.published_at = datetime.now(UTC)
    await db.flush()
    return ann


async def unpublish(db: AsyncSession, ann_id: uuid.UUID) -> Announcement:
    ann = await _get_or_404(ann_id, db)
    ann.is_published = False
    ann.is_urgent = False
    await db.flush()
    return ann


async def delete(db: AsyncSession, ann_id: uuid.UUID) -> None:
    ann = await _get_or_404(ann_id, db)
    await db.delete(ann)


async def upload_media(
    db: AsyncSession,
    ann_id: uuid.UUID,
    file: UploadFile,
    storage: StorageBackend,
) -> AnnouncementMedia:
    ann = await _get_or_404(ann_id, db)

    content = await file.read(_MEDIA_MAX_SIZE + 1)
    if len(content) > _MEDIA_MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="圖片不可超過 10 MB"
        )
    mime = file.content_type or ""
    if mime not in _MEDIA_ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="僅支援 JPEG / PNG / GIF / WebP",
        )

    # rewind so storage backend can read
    import io

    file.file = io.BytesIO(content)  # type: ignore[assignment]
    file.size = len(content)

    stored = await storage.save(file, prefix=f"announcements/{ann.id}")

    media = AnnouncementMedia(
        announcement_id=ann.id,
        filename=stored.filename,
        storage_key=stored.storage_key,
        mime_type=stored.content_type,
        file_size=stored.file_size,
    )
    db.add(media)
    await db.flush()
    await db.refresh(media)
    return media


async def delete_media(
    db: AsyncSession,
    ann_id: uuid.UUID,
    media_id: uuid.UUID,
    storage: StorageBackend,
) -> None:
    result = await db.execute(
        select(AnnouncementMedia).where(
            AnnouncementMedia.id == media_id,
            AnnouncementMedia.announcement_id == ann_id,
        )
    )
    media = result.scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="媒體不存在")
    await storage.delete(media.storage_key)
    await db.delete(media)


async def record_read(db: AsyncSession, ann_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """記錄使用者閱讀公告（INSERT ON CONFLICT DO NOTHING）。"""
    stmt = (
        pg_insert(AnnouncementRead)
        .values(id=uuid.uuid4(), announcement_id=ann_id, user_id=user_id)
        .on_conflict_do_nothing(constraint="uq_announcement_reads")
    )
    await db.execute(stmt)


async def get_stats(db: AsyncSession, ann_id: uuid.UUID) -> AnnouncementStatsOut:
    """取得公告閱讀統計。"""
    ann = await _get_or_404(ann_id, db)
    count = await db.scalar(
        select(func.count(AnnouncementRead.id)).where(AnnouncementRead.announcement_id == ann_id)
    )
    return AnnouncementStatsOut(
        announcement_id=ann.id,
        title=ann.title,
        reader_count=int(count or 0),
        published_at=ann.published_at,
    )


async def get_active_urgent(
    db: AsyncSession, scope: ViewerScope | None = None
) -> Announcement | None:
    now = datetime.now(UTC)
    q = (
        select(Announcement)
        .where(
            Announcement.is_urgent == True,  # noqa: E712
            Announcement.is_published == True,  # noqa: E712
            (Announcement.urgent_until == None) | (Announcement.urgent_until >= now),  # noqa: E711
        )
        .options(selectinload(Announcement.media), selectinload(Announcement.author))
        .order_by(Announcement.published_at.desc().nullslast())
        .limit(1)
    )
    if scope is not None:
        q = q.where(_audience_clause(scope))
    result = await db.execute(q)
    return result.scalar_one_or_none()
