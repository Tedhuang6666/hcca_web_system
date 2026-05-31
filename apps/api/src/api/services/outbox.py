"""Outbox service — 寫入事件和處理器分派"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.outbox import OutboxEvent, OutboxStatus

logger = logging.getLogger(__name__)

_MAX_RETRY = 5


async def emit(
    session: AsyncSession,
    *,
    event_type: str,
    payload: dict[str, Any],
) -> OutboxEvent:
    """在現有事務中寫入一筆 Outbox 事件（同事務 flush，隨主事務 commit 生效）。"""
    event = OutboxEvent(
        event_type=event_type,
        payload=payload,
        status=OutboxStatus.PENDING,
        created_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()
    return event


# ── Celery handler（同步，在 Celery worker 中執行）────────────────────────────


def _dispatch(event: OutboxEvent) -> None:
    """根據 event_type 分派到對應的通知邏輯。擴充時在此 switch 新增分支。"""
    from api.services.mail import enqueue_email

    etype = event.event_type
    payload = event.payload

    if etype == "document.approved":
        enqueue_email(
            payload.get("creator_email", ""),
            f"【核准】公文 {payload.get('serial', '')} 已核准",
            f"<p>您的公文「{payload.get('title', '')}」已完成審核。</p>",
        )
    elif etype == "document.rejected":
        enqueue_email(
            payload.get("creator_email", ""),
            f"【退件】公文 {payload.get('serial', '')} 被退件",
            f"<p>退件原因：{payload.get('comment', '（未填）')}</p>",
        )
    elif etype == "regulation.published":
        pass  # 未來：通知訂閱者
    elif etype == "order.created":
        pass  # 未來：購票確認信
    elif etype == "line.push":
        from api.services.line_bot import push_text_message

        text = str(payload.get("title") or "平台通知")
        body = payload.get("body")
        link = payload.get("link")
        if body:
            text = f"{text}\n{body}"
        if link:
            from api.core.config import settings

            base = settings.FRONTEND_BASE_URL.rstrip("/")
            href = str(link)
            if not href.startswith(("http://", "https://")):
                href = f"{base}{href if href.startswith('/') else '/' + href}"
            text = f"{text}\n{href}"
        push_text_message(str(payload.get("line_user_id")), text)
    elif etype == "discord.push":
        from api.services.discord_bot import format_discord_payload, send_dm

        title, body = format_discord_payload(payload)
        send_dm(str(payload.get("discord_user_id")), title=title, body=body)
    elif etype == "discord.channel_alert":
        from api.services.discord_bot import format_discord_payload, send_channel_message

        embed = payload.get("embed")
        components = payload.get("components")
        thread_name = payload.get("thread_name")
        if embed is not None:
            send_channel_message(
                str(payload.get("channel_id")),
                embed=embed,
                components=components,
                thread_name=thread_name,
            )
        else:
            title, body = format_discord_payload(payload)
            send_channel_message(
                str(payload.get("channel_id")),
                title=title,
                body=body,
                components=components,
                thread_name=thread_name,
            )
    elif etype == "discord.embed_alert":
        from api.services.discord_bot import send_channel_message

        send_channel_message(
            str(payload.get("channel_id")),
            embed=payload.get("embed"),
            components=payload.get("components"),
            thread_name=payload.get("thread_name"),
        )
    elif etype == "discord.user_dm":
        from api.services.discord_bot import dispatch_user_dm

        dispatch_user_dm(payload)
    elif etype == "discord.role_sync":
        from api.services.discord_bot import sync_member_roles

        sync_member_roles(
            str(payload.get("guild_id")),
            str(payload.get("discord_user_id")),
            list(payload.get("role_ids") or []),
            list(payload.get("managed_role_ids") or []),
            payload.get("nickname_prefix"),
            list(payload.get("managed_nickname_prefixes") or []),
        )
    elif etype == "discord.petition_channel_create":
        from api.services.discord_bot import create_petition_private_channel

        create_petition_private_channel(payload)
    elif etype == "email.send":
        # 通用 email 發送事件：解耦業務模組（meal/digest/...）對 mail service 的直接依賴
        to = payload.get("to", "")
        subject = payload.get("subject", "")
        body_text = payload.get("body", "")
        subtype = payload.get("subtype", "html")
        if to and subject:
            enqueue_email(to, subject, body_text, subtype)
    elif etype == "admin.notification":
        # 模組跳閘 / 恢復等系統事件 → fan-out 給所有 superuser 的 inbox
        _fan_out_admin_notification(payload)
    elif etype == "module.recovered":
        # 模組恢復事件（INFO 等級），與 admin.notification 同邏輯
        _fan_out_admin_notification(payload)
    else:
        logger.warning("Unknown outbox event_type: %s", etype)


def _fan_out_admin_notification(payload: dict) -> None:
    """將模組事件寫入所有 superuser 的 notifications 表（同步，在 Celery worker）。"""
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session

    from api.core.config import settings
    from api.models.notification import Notification
    from api.models.user import User

    sync_url = settings.DATABASE_URL.replace("+asyncpg", "")
    engine = create_engine(sync_url)
    try:
        with Session(engine) as session:
            rows = session.execute(select(User).where(User.is_superuser.is_(True))).scalars().all()
            for u in rows:
                session.add(
                    Notification(
                        user_id=u.id,
                        type="system",
                        title=str(payload.get("title", "系統通知"))[:200],
                        body=str(payload.get("body", "")),
                        link=payload.get("link"),
                    )
                )
            session.commit()
    except Exception as exc:
        logger.warning("admin notification fan-out failed: %s", exc)


def process_pending_outbox() -> None:
    """Celery Beat task：掃描並處理 pending outbox events（同步函式）。"""

    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from api.core.config import settings

    # 使用同步引擎（Celery task 不在 asyncio event loop）
    sync_url = settings.DATABASE_URL.replace("+asyncpg", "")
    engine = create_engine(sync_url)

    with Session(engine) as session:
        rows = (
            session.execute(
                select(OutboxEvent)
                .where(OutboxEvent.status == OutboxStatus.PENDING)
                .order_by(OutboxEvent.created_at)
                .limit(50)
                .with_for_update(skip_locked=True)
            )
            .scalars()
            .all()
        )

        for event in rows:
            try:
                _dispatch(event)
                event.status = OutboxStatus.PROCESSED
                event.processed_at = datetime.now(UTC)
            except Exception as exc:
                event.retry_count += 1
                event.last_error = str(exc)
                if event.retry_count >= _MAX_RETRY:
                    event.status = OutboxStatus.DEAD
                    logger.error(
                        "Outbox event %s dead after %d retries: %s", event.id, _MAX_RETRY, exc
                    )
                else:
                    logger.warning(
                        "Outbox event %s failed (retry %d): %s", event.id, event.retry_count, exc
                    )
        session.commit()
