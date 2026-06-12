"""Discord slash command gateway。

Bot 只負責 Discord UI；平台身分、權限、查詢與異動全部在此 service 執行。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.core.database import engine
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import get_load_shed_force_mode, get_maintenance_state
from api.core.metrics import get_celery_stats, get_db_pool_stats, get_redis_stats
from api.models.announcement import Announcement
from api.models.calendar import CalendarEvent, CalendarEventParticipant
from api.models.discord_account import DEFAULT_DM_CATEGORIES, DiscordNotificationPreference
from api.models.document import Document, DocumentStatus
from api.models.meal import MealOrderStatus, MealVendor, MenuSchedule
from api.models.meeting import Meeting, MeetingStatus
from api.models.org import Position, UserPosition
from api.models.petition import PetitionStatus
from api.models.regulation import Regulation, RegulationArticle
from api.models.survey import Survey, SurveyStatus
from api.models.user import User
from api.models.work_item import WorkItem, WorkItemStatus
from api.routers.notifications import create_notification
from api.schemas.announcement import AnnouncementAudience, AnnouncementCreate
from api.schemas.calendar import CalendarEventCreate
from api.schemas.document import RejectMode
from api.schemas.meal import MealOrderCreate, MealOrderItemCreate
from api.schemas.meeting import MeetingCreate
from api.schemas.petition import PetitionCreate, PetitionInternalNoteCreate, PetitionStatusUpdate
from api.schemas.survey import SurveyCreate
from api.schemas.work_item import WorkItemCreate
from api.services import announcement as announcement_svc
from api.services import audit as audit_svc
from api.services import calendar as calendar_svc
from api.services import defense as defense_svc
from api.services import document as document_svc
from api.services import meal as meal_svc
from api.services import meeting as meeting_svc
from api.services import petition as petition_svc
from api.services import survey as survey_svc
from api.services import work_item as work_item_svc
from api.services.discord_bot import (
    bot_health_snapshot,
    create_open_url,
    emit_moderation_log,
    emit_public_document_notice,
    enqueue_all_role_sync,
    enqueue_petition_private_channel,
    enqueue_role_sync,
    get_user_by_discord_id,
)
from api.services.discord_regulation import lookup_citation, parse_citations
from api.services.permission import (
    active_tenure_filter,
    get_user_permission_codes,
)
from api.services.task_inbox import build_task_inbox


class DiscordCommandError(ValueError):
    pass


def _has_permission(user: User, codes: frozenset[str], code: str) -> bool:
    return user.is_superuser or "admin:all" in codes or code in codes


async def _actor(db: AsyncSession, discord_user_id: str) -> tuple[User, frozenset[str]]:
    user = await get_user_by_discord_id(db, discord_user_id)
    if user is None:
        raise DiscordCommandError("請先到平台個人資料頁綁定 Discord，再使用辦公功能。")
    return user, await get_user_permission_codes(db, user.id)


async def _require(
    db: AsyncSession, discord_user_id: str, permission: str
) -> tuple[User, frozenset[str]]:
    user, codes = await _actor(db, discord_user_id)
    if not _has_permission(user, codes, permission):
        raise DiscordCommandError("你沒有執行此操作的權限。")
    return user, codes


async def _primary_org(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    org_id = await db.scalar(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(*active_tenure_filter(local_today()))
        .limit(1)
    )
    if org_id is None:
        raise DiscordCommandError("找不到你的所屬機關，請先在平台確認任期。")
    return org_id


async def _audit(
    db: AsyncSession,
    user: User,
    *,
    interaction_id: str,
    guild_id: str | None,
    entity_type: str,
    entity_id: str,
    action: str,
    summary: str,
    meta: dict[str, Any] | None = None,
) -> None:
    detail = {**(meta or {}), "discord_interaction_id": interaction_id}
    await audit_svc.record(
        db,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=str(user.id),
        actor_email=user.email,
        meta=detail,
        summary=summary,
    )
    if action.startswith("discord.community."):
        await emit_moderation_log(
            db,
            guild_id=guild_id,
            title=summary,
            body="\n".join(f"{key}: {value}" for key, value in detail.items()),
        )


def _task(item: Any) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "title": item.title,
        "subtitle": item.subtitle,
        "module": item.module,
        "href": item.href,
        "due_at": item.due_at.isoformat() if item.due_at else None,
    }


async def _preference(db: AsyncSession, user_id: uuid.UUID) -> DiscordNotificationPreference:
    pref = await db.get(DiscordNotificationPreference, user_id)
    if pref is None:
        pref = DiscordNotificationPreference(
            user_id=user_id,
            preferences=dict(DEFAULT_DM_CATEGORIES),
        )
        db.add(pref)
        await db.flush()
    return pref


def _preference_data(pref: DiscordNotificationPreference) -> dict[str, Any]:
    return {
        "preferences": pref.preferences or {},
        "digest_daily_enabled": pref.digest_daily_enabled,
        "digest_weekly_enabled": pref.digest_weekly_enabled,
        "quiet_hours_start": (
            pref.quiet_hours_start.strftime("%H:%M") if pref.quiet_hours_start else None
        ),
        "quiet_hours_end": (
            pref.quiet_hours_end.strftime("%H:%M") if pref.quiet_hours_end else None
        ),
        "timezone": pref.timezone,
    }


async def execute(
    db: AsyncSession,
    *,
    operation: str,
    discord_user_id: str,
    interaction_id: str,
    guild_id: str | None,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    if operation == "context":
        user, codes = await _actor(db, discord_user_id)
        return {
            "id": str(user.id),
            "display_name": user.display_name,
            "email": user.email,
            "permissions": sorted(codes),
            "is_superuser": user.is_superuser,
        }

    if operation == "user_lookup":
        target = await get_user_by_discord_id(db, str(arguments["discord_user_id"]))
        return {
            "linked": target is not None,
            "display_name": target.display_name if target else None,
            "email": target.email if target else None,
        }

    if operation == "regulation_citations":
        results = []
        for citation in parse_citations(str(arguments.get("content") or ""), limit=3):
            found = await lookup_citation(db, citation)
            if found is None:
                continue
            regulation, article = found
            results.append(
                {
                    "title": regulation.title,
                    "legal_number": article.legal_number,
                    "subtitle": article.subtitle,
                    "content": article.content,
                    "url": f"/regulations/{regulation.id}",
                }
            )
        return {"items": results}

    user, codes = await _actor(db, discord_user_id)

    if operation == "tasks":
        inbox = await build_task_inbox(db, user)
        return {
            "total": inbox.total,
            "items": [_task(item) for item in inbox.items],
            "open_url": await create_open_url(user.id, "/dashboard"),
        }

    if operation == "dashboard":
        inbox = await build_task_inbox(db, user)
        now = datetime.now(UTC)
        horizon = now + timedelta(days=14)
        positions = (
            await db.execute(
                select(Position.name)
                .join(UserPosition, UserPosition.position_id == Position.id)
                .where(UserPosition.user_id == user.id)
                .where(*active_tenure_filter(local_today()))
                .distinct()
            )
        ).scalars()
        cases = await petition_svc.list_cases(db, assigned_to_id=user.id, limit=25)
        meetings = (
            await db.execute(
                select(Meeting)
                .where(
                    Meeting.starts_at.is_not(None),
                    Meeting.starts_at >= now,
                    Meeting.starts_at <= horizon,
                    Meeting.status.in_(
                        [MeetingStatus.DRAFT, MeetingStatus.CONFIRMED, MeetingStatus.ACTIVE]
                    ),
                )
                .order_by(Meeting.starts_at)
                .limit(25)
            )
        ).scalars()
        calendar = (
            await db.execute(
                select(CalendarEvent)
                .join(
                    CalendarEventParticipant,
                    CalendarEventParticipant.event_id == CalendarEvent.id,
                )
                .where(
                    CalendarEventParticipant.user_id == user.id,
                    CalendarEvent.starts_at >= now,
                    CalendarEvent.starts_at <= horizon,
                    CalendarEvent.is_active.is_(True),
                )
                .order_by(CalendarEvent.starts_at)
                .limit(25)
            )
        ).scalars()
        return {
            "display_name": user.display_name,
            "positions": list(positions),
            "tasks": [_task(item) for item in inbox.items],
            "petitions": [
                {
                    "id": str(item.id),
                    "case_number": item.case_number,
                    "title": item.title,
                    "status": str(item.status),
                }
                for item in cases
            ],
            "meetings": [
                {
                    "id": str(item.id),
                    "title": item.title,
                    "starts_at": item.starts_at.isoformat() if item.starts_at else None,
                    "location": item.location,
                }
                for item in meetings
            ],
            "calendar": [
                {
                    "id": str(item.id),
                    "title": item.title,
                    "starts_at": item.starts_at.isoformat(),
                    "location": item.location,
                }
                for item in calendar
            ],
            "open_url": await create_open_url(user.id, "/dashboard"),
        }

    if operation == "sync_me":
        await enqueue_role_sync(db, user.id)
        return {}

    if operation == "unlink":
        from api.services.discord_bot import unlink_user

        await unlink_user(db, user.id)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="discord_account_link",
            entity_id=str(user.id),
            action="discord.unlink",
            summary="使用者經 Discord 解除綁定",
            meta={"discord_user_id": discord_user_id},
        )
        return {}

    if operation == "sync_all":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有 Discord 社群管理權限。")
        queued = await enqueue_all_role_sync(db)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="discord_account_link",
            entity_id="all",
            action="discord.sync_all",
            summary="Discord 排程同步所有已綁定成員",
            meta={"queued": queued},
        )
        return {"queued": queued}

    if operation == "system_status":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有系統管理權限。")
        pool = get_db_pool_stats(engine)
        return {
            "db_checked_out": pool.checked_out,
            "db_utilization": pool.utilization,
            "redis": await get_redis_stats(),
            "celery": await get_celery_stats(),
            "maintenance": await get_maintenance_state(),
            "load_shed": await get_load_shed_force_mode(),
            "load": load_snapshot(),
        }

    if operation == "defense_summary":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有系統管理權限。")
        return await defense_svc.summary(db)

    if operation == "server_health":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有 Discord 社群管理權限。")
        return {
            "system": await execute(
                db,
                operation="system_status",
                discord_user_id=discord_user_id,
                interaction_id=interaction_id,
                guild_id=guild_id,
                arguments={},
            ),
            "defense": await defense_svc.summary(db),
            "bot": await bot_health_snapshot(db),
        }

    if operation == "assign_task":
        assignee = await get_user_by_discord_id(db, str(arguments["assignee_discord_user_id"]))
        if assignee is None:
            raise DiscordCommandError("對方尚未綁定平台帳號。")
        due_at = arguments.get("due_at")
        item = await work_item_svc.create_work_item(
            db,
            data=WorkItemCreate(
                title=str(arguments["title"]),
                description=arguments.get("description"),
                assigned_to_id=assignee.id,
                due_at=datetime.fromisoformat(due_at) if due_at else None,
                source_type="discord",
            ),
            created_by_id=user.id,
        )
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="work_item",
            entity_id=str(item.id),
            action="discord.work_item.create",
            summary=f"Discord 指派工作：{item.title}",
            meta={"assignee": str(arguments["assignee_discord_user_id"])},
        )
        return {"id": str(item.id), "title": item.title}

    if operation == "complete_task":
        try:
            item = await work_item_svc.get_work_item(db, uuid.UUID(str(arguments["task_id"])))
        except ValueError:
            item = None
        if item is None or item.assigned_to_id != user.id:
            raise DiscordCommandError("找不到可由你完成的工作。")
        await work_item_svc.complete_work_item(db, item=item)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="work_item",
            entity_id=str(item.id),
            action="discord.work_item.complete",
            summary=f"Discord 完成工作：{item.title}",
        )
        return {"title": item.title}

    if operation == "work_item_choices":
        rows = (
            await db.execute(
                select(WorkItem)
                .where(
                    WorkItem.assigned_to_id == user.id,
                    WorkItem.status != WorkItemStatus.DONE,
                )
                .order_by(WorkItem.created_at.desc())
                .limit(25)
            )
        ).scalars()
        return {"items": [{"id": str(row.id), "title": row.title} for row in rows]}

    if operation == "documents_pending":
        inbox = await build_task_inbox(db, user)
        docs = [item for item in inbox.items if item.module == "document"][:5]
        return {
            "items": [
                {
                    **_task(item),
                    "document_id": item.id.split(":")[-1],
                    "open_url": await create_open_url(user.id, item.href),
                }
                for item in docs
            ]
        }

    if operation in {"document_approve", "document_reject"}:
        permission = "document:approve" if operation == "document_approve" else "document:reject"
        if not _has_permission(user, codes, permission):
            raise DiscordCommandError("你沒有處理此公文的權限。")
        document = await document_svc.get_document(db, uuid.UUID(str(arguments["document_id"])))
        if document is None:
            raise DiscordCommandError("找不到此公文。")
        try:
            if operation == "document_approve":
                updated = await document_svc.approve_step(
                    db, document, approver_id=user.id, comment="Discord 核准"
                )
            elif arguments.get("mode") == RejectMode.TO_PREVIOUS:
                updated = await document_svc.reject_to_previous_step(
                    db,
                    document,
                    approver_id=user.id,
                    comment=str(arguments["comment"]),
                )
            else:
                updated = await document_svc.reject_step(
                    db,
                    document,
                    approver_id=user.id,
                    comment=str(arguments["comment"]),
                )
        except (PermissionError, ValueError) as exc:
            raise DiscordCommandError(str(exc)) from exc
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="document",
            entity_id=str(updated.id),
            action=f"discord.{operation.replace('_', '.')}",
            summary=f"Discord {'核准' if operation == 'document_approve' else '退回'}公文「{updated.title}」",
        )
        if updated.status == DocumentStatus.APPROVED:
            await create_notification(
                db,
                user_id=updated.created_by,
                type="document_approved",
                title=f"公文已核准：{updated.title}",
                body=f"字號：{updated.serial_number}",
                link=f"/documents/{updated.id}",
                related_id=updated.id,
            )
            await emit_public_document_notice(db, updated)
        return {"title": updated.title}

    if operation == "petition_create":
        types = await petition_svc.list_types(db, active_only=True)
        if not types:
            raise DiscordCommandError("目前沒有可用的陳情類型。")
        anonymous = bool(arguments.get("anonymous"))
        case_obj, code = await petition_svc.create_case(
            db,
            data=PetitionCreate(
                type_id=types[0].id,
                is_named=not anonymous,
                contact_name=None if anonymous else user.display_name,
                contact_email=None if anonymous else user.email,
                title=str(arguments["title"]),
                content=str(arguments["content"]),
            ),
            submitter=user,
        )
        await enqueue_petition_private_channel(db, case_obj)
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="petition_case",
            entity_id=str(case_obj.id),
            action="discord.petition.create",
            summary=f"Discord 建立陳情案件 {case_obj.case_number}",
            meta={"case_number": case_obj.case_number, "is_anonymous": anonymous},
        )
        return {"case_number": case_obj.case_number, "verification_code": code}

    if operation in {"petitions_pending", "petition_choices"}:
        cases = await petition_svc.list_cases(db, assigned_to_id=user.id, limit=25)
        return {
            "items": [
                {
                    "id": str(item.id),
                    "case_number": item.case_number,
                    "title": item.title,
                    "status": str(item.status),
                    "open_url": await create_open_url(user.id, f"/petitions/manage?case={item.id}"),
                }
                for item in cases
            ]
        }

    if operation in {"petition_note", "petition_channel", "petition_in_progress"}:
        if not _has_permission(user, codes, "petition:handle"):
            raise DiscordCommandError("你沒有處理陳情權限。")
        case_obj = await petition_svc.get_case(db, uuid.UUID(str(arguments["case_id"])))
        if case_obj is None:
            raise DiscordCommandError("找不到此陳情案件。")
        if operation == "petition_note":
            await petition_svc.add_internal_note(
                db,
                case_obj,
                data=PetitionInternalNoteCreate(content=str(arguments["content"])),
                actor_id=user.id,
            )
        elif operation == "petition_channel":
            if not await enqueue_petition_private_channel(db, case_obj, force=True):
                raise DiscordCommandError("此案件已有頻道，或後台尚未完成頻道設定。")
        else:
            case_obj = await petition_svc.update_status(
                db,
                case_obj,
                data=PetitionStatusUpdate(
                    status=PetitionStatus.IN_PROGRESS,
                    internal_note="Discord 標記處理中",
                ),
                actor_id=user.id,
            )
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="petition_case",
            entity_id=str(case_obj.id),
            action=f"discord.{operation.replace('_', '.')}",
            summary=f"Discord 更新陳情案件 {case_obj.case_number}",
        )
        return {"case_number": case_obj.case_number}

    if operation.startswith("notify_"):
        pref = await _preference(db, user.id)
        if operation == "notify_update":
            if "preferences" in arguments:
                pref.preferences = {
                    key: bool(value) for key, value in dict(arguments["preferences"]).items()
                }
            if "digest_daily_enabled" in arguments:
                pref.digest_daily_enabled = bool(arguments["digest_daily_enabled"])
            if "digest_weekly_enabled" in arguments:
                pref.digest_weekly_enabled = bool(arguments["digest_weekly_enabled"])
        elif operation == "notify_reset":
            pref.preferences = dict(DEFAULT_DM_CATEGORIES)
            pref.digest_daily_enabled = True
            pref.digest_weekly_enabled = False
            pref.quiet_hours_start = None
            pref.quiet_hours_end = None
            pref.timezone = "Asia/Taipei"
        elif operation == "notify_quiet":
            start = arguments.get("start")
            end = arguments.get("end")
            pref.quiet_hours_start = time.fromisoformat(start) if start else None
            pref.quiet_hours_end = time.fromisoformat(end) if end else None
        return _preference_data(pref)

    if operation == "browse_announcements":
        statement = (
            select(Announcement)
            .where(Announcement.is_published.is_(True))
            .order_by(Announcement.published_at.desc().nullslast())
            .limit(10)
        )
        if arguments.get("urgent_only"):
            statement = statement.where(Announcement.is_urgent.is_(True))
        rows = (await db.execute(statement)).scalars()
        return {
            "items": [
                {
                    "title": row.title,
                    "is_urgent": row.is_urgent,
                    "published_at": row.published_at.isoformat() if row.published_at else None,
                    "url": await create_open_url(user.id, f"/announcements/{row.id}"),
                }
                for row in rows
            ]
        }

    if operation == "browse_meetings":
        now = datetime.now(UTC)
        rows = (
            await db.execute(
                select(Meeting)
                .where(
                    Meeting.starts_at.is_not(None),
                    Meeting.starts_at >= now,
                    Meeting.starts_at <= now + timedelta(days=14),
                    Meeting.status.in_(
                        [
                            MeetingStatus.DRAFT,
                            MeetingStatus.CONFIRMED,
                            MeetingStatus.CHECKIN,
                            MeetingStatus.ACTIVE,
                            MeetingStatus.BREAK,
                            MeetingStatus.PAUSED,
                        ]
                    ),
                )
                .order_by(Meeting.starts_at)
                .limit(10)
            )
        ).scalars()
        return {
            "items": [
                {
                    "title": row.title,
                    "starts_at": row.starts_at.isoformat() if row.starts_at else None,
                    "location": row.location,
                    "status": str(row.status),
                    "url": await create_open_url(user.id, f"/meetings/{row.id}"),
                }
                for row in rows
            ]
        }

    if operation == "browse_events":
        now = datetime.now(UTC)
        day_start = datetime.combine(now.date(), time.min, tzinfo=UTC)
        rows = (
            await db.execute(
                select(CalendarEvent)
                .where(
                    CalendarEvent.starts_at >= day_start,
                    CalendarEvent.starts_at < day_start + timedelta(days=1),
                    CalendarEvent.is_active.is_(True),
                )
                .order_by(CalendarEvent.starts_at)
                .limit(10)
            )
        ).scalars()
        return {
            "items": [
                {
                    "title": row.title,
                    "starts_at": row.starts_at.isoformat(),
                    "ends_at": row.ends_at.isoformat() if row.ends_at else None,
                    "location": row.location,
                    "url": await create_open_url(user.id, row.href or f"/calendar/events/{row.id}"),
                }
                for row in rows
            ]
        }

    if operation in {"browse_surveys", "survey_choices"}:
        rows = (
            await db.execute(
                select(Survey)
                .where(Survey.status == SurveyStatus.OPEN)
                .order_by(Survey.closes_at.asc().nullslast())
                .limit(25 if operation == "survey_choices" else 10)
            )
        ).scalars()
        return {
            "items": [
                {
                    "id": str(row.id),
                    "title": row.title,
                    "closes_at": row.closes_at.isoformat() if row.closes_at else None,
                    "is_anonymous": row.is_anonymous,
                    "url": await create_open_url(user.id, f"/surveys/{row.id}"),
                }
                for row in rows
            ]
        }

    if operation in {"browse_regulations", "regulation_choices"}:
        statement = (
            select(Regulation)
            .where(Regulation.is_active.is_(True))
            .order_by(Regulation.updated_at.desc())
            .limit(25 if operation == "regulation_choices" else 10)
        )
        query = str(arguments.get("query") or "").lower()
        if query:
            statement = statement.where(func.lower(Regulation.title).contains(query))
        rows = (await db.execute(statement)).scalars()
        return {
            "items": [
                {
                    "id": str(row.id),
                    "title": row.title,
                    "version": row.version,
                    "workflow_status": str(row.workflow_status),
                    "published": row.published_at is not None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    "url": await create_open_url(user.id, f"/regulations/{row.id}"),
                }
                for row in rows
            ]
        }

    if operation == "search":
        query = str(arguments["query"])
        if len(query) < 2:
            raise DiscordCommandError("關鍵字至少 2 個字。")
        scope = str(arguments.get("scope") or "all")
        needle = f"%{query}%"
        items: list[dict[str, Any]] = []
        if scope in {"all", "announcement"}:
            rows = (
                await db.execute(
                    select(Announcement)
                    .where(
                        Announcement.title.ilike(needle),
                        Announcement.is_published.is_(True),
                    )
                    .order_by(Announcement.published_at.desc().nullslast())
                    .limit(5)
                )
            ).scalars()
            for row in rows:
                items.append(
                    {
                        "type": "announcement",
                        "title": row.title,
                        "url": await create_open_url(user.id, f"/announcements/{row.id}"),
                    }
                )
        if scope in {"all", "document"}:
            rows = (
                await db.execute(
                    select(Document)
                    .where(
                        or_(
                            Document.title.ilike(needle),
                            Document.subject.ilike(needle),
                            Document.serial_number.ilike(needle),
                        )
                    )
                    .order_by(Document.updated_at.desc())
                    .limit(5)
                )
            ).scalars()
            for row in rows:
                items.append(
                    {
                        "type": "document",
                        "title": row.title,
                        "subtitle": row.serial_number,
                        "url": await create_open_url(user.id, f"/documents/{row.id}"),
                    }
                )
        if scope in {"all", "regulation"}:
            rows = (
                await db.execute(
                    select(Regulation)
                    .where(
                        Regulation.title.ilike(needle),
                        Regulation.is_active.is_(True),
                    )
                    .order_by(Regulation.updated_at.desc())
                    .limit(5)
                )
            ).scalars()
            for row in rows:
                items.append(
                    {
                        "type": "regulation",
                        "title": row.title,
                        "subtitle": f"v{row.version}",
                        "url": await create_open_url(user.id, f"/regulations/{row.id}"),
                    }
                )
        return {"items": items}

    if operation == "regulation_quote":
        regulation = await db.get(Regulation, uuid.UUID(str(arguments["regulation_id"])))
        if regulation is None:
            raise DiscordCommandError("找不到這條法規。")
        statement = (
            select(RegulationArticle)
            .where(
                RegulationArticle.regulation_id == regulation.id,
                RegulationArticle.is_deleted.is_(False),
                RegulationArticle.content.is_not(None),
            )
            .order_by(RegulationArticle.sort_index)
        )
        if arguments.get("article_no"):
            statement = statement.where(
                RegulationArticle.legal_number == str(arguments["article_no"]).strip()
            )
        article = await db.scalar(statement.limit(1))
        if article is None:
            raise DiscordCommandError("找不到可顯示的條文。")
        return {
            "title": regulation.title,
            "legal_number": article.legal_number,
            "subtitle": article.subtitle,
            "content": article.content,
            "url": await create_open_url(user.id, f"/regulations/{regulation.id}"),
        }

    if operation == "shortlink":
        path = str(arguments["path"])
        if not path.startswith("/"):
            raise DiscordCommandError("path 必須以 / 開頭。")
        return {"url": await create_open_url(user.id, path)}

    if operation == "meal_today":
        today = local_today()
        rows = (
            await db.execute(
                select(MenuSchedule, MealVendor)
                .join(MealVendor, MealVendor.id == MenuSchedule.vendor_id)
                .where(MenuSchedule.date == today)
                .options(selectinload(MenuSchedule.items))
                .order_by(MenuSchedule.order_deadline.asc().nullslast())
                .limit(25)
            )
        ).all()
        return {
            "date": today.isoformat(),
            "schedules": [
                {
                    "id": str(schedule.id),
                    "vendor_name": vendor.name,
                    "is_closed": schedule.is_closed,
                    "order_deadline": (
                        schedule.order_deadline.isoformat() if schedule.order_deadline else None
                    ),
                    "items": [
                        {
                            "id": str(item.id),
                            "name": item.name,
                            "description": item.description,
                            "price": str(item.price),
                            "is_available": item.is_available,
                        }
                        for item in schedule.items
                    ],
                    "url": await create_open_url(user.id, f"/meal/schedules/{schedule.id}"),
                }
                for schedule, vendor in rows
            ],
        }

    if operation == "meal_week":
        today = local_today()
        schedules = await meal_svc.list_schedules(
            db,
            date_from=today,
            date_to=today + timedelta(days=7),
            limit=40,
        )
        vendors = {row.id: row.name for row in (await db.execute(select(MealVendor))).scalars()}
        return {
            "items": [
                {
                    "date": row.date.isoformat(),
                    "vendor_name": vendors.get(row.vendor_id, "商家"),
                }
                for row in schedules
            ]
        }

    if operation in {"meal_orders", "meal_cancel_choices"}:
        statuses = (
            [MealOrderStatus.PENDING, MealOrderStatus.CONFIRMED]
            if operation == "meal_cancel_choices"
            else [None]
        )
        orders = []
        for order_status in statuses:
            orders.extend(
                await meal_svc.list_meal_orders(
                    db,
                    user_id=user.id,
                    status=order_status,
                    limit=25 if operation == "meal_cancel_choices" else 10,
                )
            )
        return {
            "items": [
                {
                    "id": str(row.id),
                    "serial_number": row.serial_number,
                    "pickup_code": row.pickup_code,
                    "total_price": str(row.total_price),
                    "status": str(row.status),
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in orders[:25]
            ]
        }

    if operation == "meal_order":
        try:
            order = await meal_svc.create_meal_order(
                db,
                user_id=user.id,
                data=MealOrderCreate(
                    schedule_id=uuid.UUID(str(arguments["schedule_id"])),
                    items=[
                        MealOrderItemCreate(
                            menu_item_id=uuid.UUID(str(arguments["menu_item_id"])),
                            quantity=1,
                        )
                    ],
                ),
            )
        except (ValueError, PermissionError) as exc:
            raise DiscordCommandError(str(exc)) from exc
        return {
            "serial_number": order.serial_number,
            "pickup_code": order.pickup_code,
            "total_price": str(order.total_price),
            "url": await create_open_url(user.id, f"/meal/orders/{order.id}"),
        }

    if operation == "meal_cancel":
        order = await meal_svc.get_meal_order(db, uuid.UUID(str(arguments["order_id"])))
        if order is None:
            raise DiscordCommandError("找不到此訂單。")
        try:
            await meal_svc.cancel_meal_order(db, order, requested_by=user.id)
        except (ValueError, PermissionError) as exc:
            raise DiscordCommandError(str(exc)) from exc
        return {"serial_number": order.serial_number}

    if operation in {"announcement_create", "meeting_create", "calendar_create", "survey_create"}:
        permission = {
            "announcement_create": "announcement:create",
            "meeting_create": "meeting:create",
            "calendar_create": "calendar:create",
            "survey_create": "survey:create",
        }[operation]
        if not _has_permission(user, codes, permission):
            raise DiscordCommandError("你沒有建立此項目的權限。")
        org_id = await _primary_org(db, user.id)
        if operation == "announcement_create":
            created = await announcement_svc.create_announcement(
                db,
                data=AnnouncementCreate(
                    title=str(arguments["title"]),
                    content={
                        "type": "doc",
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": str(arguments["body"])}],
                            }
                        ],
                    },
                    is_urgent=bool(arguments.get("is_urgent")),
                    org_id=org_id,
                    audience_type=AnnouncementAudience.ALL,
                ),
                created_by=user.id,
            )
        elif operation == "meeting_create":
            created = await meeting_svc.create_meeting(
                db,
                data=MeetingCreate(
                    title=str(arguments["title"]),
                    org_id=org_id,
                    location=arguments.get("location"),
                    starts_at=(
                        datetime.fromisoformat(arguments["starts_at"])
                        if arguments.get("starts_at")
                        else None
                    ),
                ),
                created_by=user.id,
            )
        elif operation == "calendar_create":
            created = await calendar_svc.create_event(
                db,
                data=CalendarEventCreate(
                    org_id=org_id,
                    title=str(arguments["title"]),
                    description=arguments.get("description"),
                    location=arguments.get("location"),
                    starts_at=datetime.fromisoformat(str(arguments["starts_at"])),
                ),
                created_by=user.id,
            )
        else:
            created = await survey_svc.create_survey(
                db,
                data=SurveyCreate(
                    title=str(arguments["title"]),
                    description=arguments.get("description"),
                    is_anonymous=bool(arguments.get("is_anonymous")),
                    org_id=org_id,
                    closes_at=datetime.now(UTC) + timedelta(days=7),
                ),
                created_by=user.id,
            )
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type=operation.removesuffix("_create"),
            entity_id=str(created.id),
            action=f"discord.{operation.replace('_', '.')}",
            summary=f"Discord 建立「{created.title}」",
        )
        return {"id": str(created.id), "title": created.title}

    if operation == "moderation_audit":
        if not _has_permission(user, codes, "admin:all"):
            raise DiscordCommandError("你沒有 Discord 社群管理權限。")
        await _audit(
            db,
            user,
            interaction_id=interaction_id,
            guild_id=guild_id,
            entity_type="discord_guild",
            entity_id=guild_id or "dm",
            action=str(arguments["action"]),
            summary=str(arguments["summary"]),
            meta=dict(arguments.get("meta") or {}),
        )
        return {}

    raise DiscordCommandError(f"不支援的 Discord operation：{operation}")


__all__ = ["DiscordCommandError", "execute"]
