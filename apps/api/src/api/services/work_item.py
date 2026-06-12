"""工作分配 service。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.discord_account import DiscordAccountLink
from api.models.work_item import WorkItem, WorkItemStatus
from api.schemas.work_item import WorkItemCreate, WorkItemUpdate
from api.services._base import apply_updates
from api.services.outbox import emit


async def create_work_item(
    db: AsyncSession, *, data: WorkItemCreate, created_by_id: uuid.UUID | None
) -> WorkItem:
    item = WorkItem(**data.model_dump(), created_by_id=created_by_id)
    db.add(item)
    await db.flush()
    await _emit_assignment_notice(db, item)
    return item


async def get_work_item(db: AsyncSession, item_id: uuid.UUID) -> WorkItem | None:
    return await db.get(WorkItem, item_id)


async def list_work_items(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    include_done: bool = False,
    limit: int = 100,
) -> list[WorkItem]:
    stmt = select(WorkItem).where(WorkItem.is_active.is_(True))
    if user_id:
        stmt = stmt.where(WorkItem.assigned_to_id == user_id)
    if not include_done:
        stmt = stmt.where(WorkItem.status == WorkItemStatus.OPEN)
    stmt = stmt.order_by(WorkItem.due_at.asc().nulls_last(), WorkItem.created_at.desc()).limit(
        limit
    )
    return list((await db.execute(stmt)).scalars().all())


async def list_work_items_by_source(
    db: AsyncSession,
    *,
    source_type: str,
    source_id: uuid.UUID,
    include_done: bool = True,
    limit: int = 100,
) -> list[WorkItem]:
    stmt = (
        select(WorkItem)
        .where(
            WorkItem.is_active.is_(True),
            WorkItem.source_type == source_type,
            WorkItem.source_id == source_id,
        )
        .order_by(WorkItem.due_at.asc().nulls_last(), WorkItem.created_at.desc())
        .limit(limit)
    )
    if not include_done:
        stmt = stmt.where(WorkItem.status == WorkItemStatus.OPEN)
    return list((await db.execute(stmt)).scalars().all())


async def update_work_item(db: AsyncSession, *, item: WorkItem, data: WorkItemUpdate) -> WorkItem:
    before_status = item.status
    payload = apply_updates(item, data)
    if item.status == WorkItemStatus.DONE and before_status != WorkItemStatus.DONE:
        item.completed_at = datetime.now(UTC)
    if item.status == WorkItemStatus.OPEN:
        item.completed_at = None
    await db.flush()
    if "assigned_to_id" in payload and item.status == WorkItemStatus.OPEN:
        await _emit_assignment_notice(db, item)
    return item


async def complete_work_item(db: AsyncSession, *, item: WorkItem) -> WorkItem:
    item.status = WorkItemStatus.DONE
    item.completed_at = datetime.now(UTC)
    await db.flush()
    return item


async def remind_due_work_items(db: AsyncSession) -> int:
    now = datetime.now(UTC)
    horizon = now + timedelta(hours=24)
    rows = (
        (
            await db.execute(
                select(WorkItem)
                .where(WorkItem.is_active.is_(True))
                .where(WorkItem.status == WorkItemStatus.OPEN)
                .where(WorkItem.assigned_to_id.is_not(None))
                .where(WorkItem.due_at.is_not(None))
                .where(WorkItem.due_at <= horizon)
                .where(WorkItem.reminder_sent_at.is_(None))
                .order_by(WorkItem.due_at.asc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    for item in rows:
        await _emit_due_notice(db, item)
        item.reminder_sent_at = now
    await db.flush()
    return len(rows)


async def _emit_assignment_notice(db: AsyncSession, item: WorkItem) -> None:
    if item.assigned_to_id is None:
        return
    link = await db.scalar(
        select(DiscordAccountLink).where(
            DiscordAccountLink.user_id == item.assigned_to_id,
            DiscordAccountLink.is_active.is_(True),
        )
    )
    if link is None:
        return
    due = f"\n期限：{item.due_at.isoformat()}" if item.due_at else ""
    await emit(
        db,
        event_type="discord.push",
        payload={
            "discord_user_id": link.discord_user_id,
            "title": f"新的工作分配：{item.title}",
            "body": f"{item.description or '請到待辦中心查看。'}{due}",
            "link": "/tasks",
        },
    )


async def _emit_due_notice(db: AsyncSession, item: WorkItem) -> None:
    if item.assigned_to_id is None:
        return
    link = await db.scalar(
        select(DiscordAccountLink).where(
            DiscordAccountLink.user_id == item.assigned_to_id,
            DiscordAccountLink.is_active.is_(True),
        )
    )
    if link is None:
        return
    await emit(
        db,
        event_type="discord.push",
        payload={
            "discord_user_id": link.discord_user_id,
            "title": f"工作期限提醒：{item.title}",
            "body": f"期限：{item.due_at.isoformat() if item.due_at else '未設定'}",
            "link": "/tasks",
        },
    )
