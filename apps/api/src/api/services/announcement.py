"""公告系統業務邏輯"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.announcement import Announcement, AnnouncementMedia, AnnouncementRead
from api.models.user import User
from api.schemas.announcement import AnnouncementCreate, AnnouncementStatsOut, AnnouncementUpdate
from api.services.storage import StorageBackend

_MEDIA_ALLOWED_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
_MEDIA_MAX_SIZE = 10 * 1024 * 1024  # 10 MB


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
    ann = Announcement(
        title=body.title,
        content=body.content,
        is_urgent=body.is_urgent,
        urgent_until=body.urgent_until,
        org_id=body.org_id,
        author_id=author.id,
    )
    db.add(ann)
    await db.flush()
    await db.refresh(ann, ["media", "author"])
    return ann


async def get(db: AsyncSession, ann_id: uuid.UUID) -> Announcement:
    return await _get_or_404(ann_id, db)


async def list_announcements(
    db: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    published_only: bool = True,
    urgent_only: bool = False,
    skip: int = 0,
    limit: int = 20,
) -> list[Announcement]:
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
    if org_id is not None:
        q = q.where(Announcement.org_id == org_id)
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
    await db.flush()
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


async def get_active_urgent(db: AsyncSession) -> Announcement | None:
    now = datetime.now(UTC)
    result = await db.execute(
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
    return result.scalar_one_or_none()
