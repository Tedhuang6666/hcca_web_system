"""Outbox service — 寫入事件和處理器分派"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.prometheus_metrics import record_outbox_delivery
from api.models.outbox import OutboxEvent, OutboxStatus

logger = logging.getLogger(__name__)

_MAX_RETRY = 5
_CLAIM_BATCH_SIZE = 50
_LEASE_SECONDS = 300


def _retry_delay(retry_count: int) -> timedelta:
    """指數退避，將短暫外部故障與 Beat 頻率解耦。"""
    return timedelta(seconds=min(3600, 5 * 2 ** max(0, retry_count - 1)))


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
        next_attempt_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()
    return event


# ── Celery handler（非同步，在 Celery worker 中以 task_session 執行）──────────


async def _dispatch(db: AsyncSession, event: OutboxEvent) -> None:
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
    elif etype == "email.send":
        # 通用 email 發送事件：解耦業務模組（meal/digest/...）對 mail service 的直接依賴
        to = payload.get("to", "")
        subject = payload.get("subject", "")
        body_text = payload.get("body", "")
        subtype = payload.get("subtype", "html")
        attachments = payload.get("attachments")
        if to and subject:
            enqueue_email(
                to,
                subject,
                body_text,
                subtype,
                attachments=attachments if isinstance(attachments, list) else None,
            )
    elif etype == "admin.notification":
        # 模組跳閘 / 恢復等系統事件 → fan-out 給所有 superuser 的 inbox
        await _fan_out_admin_notification(db, payload)
    elif etype == "module.recovered":
        # 模組恢復事件（INFO 等級），與 admin.notification 同邏輯
        await _fan_out_admin_notification(db, payload)
    elif etype == "meeting.minutes_ready":
        await _handle_meeting_minutes_ready(db, payload)
    elif etype == "regulation.published":
        await _handle_regulation_published(db, payload)
    elif etype == "shop.order_confirmed":
        _handle_shop_order_confirmed(payload)
    elif etype == "announcement.published":
        await _handle_announcement_published(db, payload)
    elif etype == "petition.external_notify":
        _handle_petition_external_notify(payload)
    else:
        logger.warning("Unknown outbox event_type: %s", etype)


async def _fan_out_admin_notification(db: AsyncSession, payload: dict) -> None:
    """將模組事件寫入所有 superuser 的 notifications 表。"""
    from sqlalchemy import select

    from api.models.notification import Notification
    from api.models.user import User

    rows = (await db.execute(select(User).where(User.is_superuser.is_(True)))).scalars().all()
    for user in rows:
        db.add(
            Notification(
                user_id=user.id,
                type="system",
                title=str(payload.get("title", "系統通知"))[:200],
                body=str(payload.get("body", "")),
                link=payload.get("link"),
            )
        )


async def _handle_meeting_minutes_ready(db: AsyncSession, payload: dict) -> None:
    """結束會議後建立「會議紀錄準備中」通知信草稿供主席確認後發送。"""
    import uuid as _uuid

    from sqlalchemy import select

    from api.core.config import settings
    from api.models.email_message import EmailCampaignRecipient, EmailMessage, EmailStatus
    from api.models.user import User

    meeting_id = payload.get("meeting_id")
    meeting_title = payload.get("meeting_title", "會議")
    attendee_ids = payload.get("attendee_ids", [])
    actor_id = payload.get("actor_id")
    org_id = payload.get("org_id")
    if not meeting_id or not attendee_ids:
        return

    idem_key = f"meeting-minutes-ready-{meeting_id}"
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    existing = await db.scalar(select(EmailMessage).where(EmailMessage.idempotency_key == idem_key))
    if existing:
        return
    ids = [_uuid.UUID(uid) for uid in attendee_ids]
    users = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    external_emails = [u.email for u in users if u.email]
    rv = [
        {
            "user_id": str(u.id),
            "email": u.email,
            "name": u.display_name or u.email,
            "variables": {"姓名": u.display_name or u.email},
        }
        for u in users
        if u.email
    ]
    context = {
        "blocks": [],
        "buttons": [
            {"url": f"{base}/meetings/{meeting_id}", "label": "查看會議", "style": "primary"}
        ],
        "cta_url": "",
        "heading": f"「{meeting_title}」已圓滿結束",
        "card_rows": [{"label": "會議", "value": meeting_title}],
        "cta_label": "",
        "footer_text": "",
        "accent_color": "#111827",
        "preview_text": f"{meeting_title} 會議紀錄整理中",
        "background_color": "#eef2f7",
        "banner_image_alt": "",
        "banner_image_url": "",
        "body_line_height": 1.6,
        "paragraph_spacing": 18,
        "show_system_footer": True,
        "content_background_color": "#ffffff",
    }
    msg = EmailMessage(
        sender_id=_uuid.UUID(actor_id) if actor_id else None,
        org_id=_uuid.UUID(org_id) if org_id else None,
        subject=f"【會議紀錄準備中】{meeting_title}",
        body=f"### {{{{ 姓名 }}}}您好，\n\n「{meeting_title}」已圓滿結束，會議紀錄正在整理中，完成後將另行公告。",
        template="generic",
        context=context,
        recipient_spec={"external_emails": external_emails},
        variable_definitions=[
            {"key": "姓名", "label": "姓名", "required": False, "default_value": "您"}
        ],
        default_variables={"姓名": "您"},
        recipient_variables=rv,
        resolved_emails=external_emails,
        recipient_count=len(external_emails),
        status=EmailStatus.DRAFT,
        idempotency_key=idem_key,
    )
    db.add(msg)
    await db.flush()
    for recipient in rv:
        db.add(
            EmailCampaignRecipient(
                message_id=msg.id,
                user_id=_uuid.UUID(recipient["user_id"]),
                email=recipient["email"],
                name=recipient["name"],
                variables=recipient["variables"],
                status="queued",
            )
        )


async def _handle_regulation_published(db: AsyncSession, payload: dict) -> None:
    """法規公布後，對啟用 regulation_published email 偏好的用戶發送通知。"""
    from sqlalchemy import select

    from api.core.config import settings
    from api.models.user import User
    from api.services.mail import enqueue_email
    from api.services.notification_pref import normalize_preferences

    reg_title = payload.get("regulation_title", "法規")
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    users = (await db.execute(select(User).where(User.is_active.is_(True)))).scalars().all()
    for user in users:
        if not user.email:
            continue
        prefs = normalize_preferences(user.notification_preferences or {})
        if prefs.get("regulation_published", {}).get("email"):
            subject = f"【法規公布】{reg_title}"
            html = (
                f"<p>法規《{reg_title}》已由主席正式公布生效。</p>"
                f'<p><a href="{base}/regulations">查看法規庫</a></p>'
            )
            try:
                enqueue_email(user.email, subject, html)
            except Exception as exc:
                logger.warning("regulation.published email failed user=%s: %s", user.id, exc)


def _handle_shop_order_confirmed(payload: dict) -> None:
    """購物結帳後發送訂單確認信給買家。"""
    from api.core.config import settings
    from api.services.mail import enqueue_email

    buyer_email = payload.get("buyer_email", "")
    buyer_name = payload.get("buyer_name", "")
    serial = payload.get("serial_number", "")
    total = payload.get("total_price", 0)
    if not buyer_email or not serial:
        return
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    subject = f"【訂單確認】{serial}"
    html = (
        f"<p>親愛的 {buyer_name or '同學'}，感謝您的訂購！</p>"
        f"<p><strong>訂單編號</strong>：{serial}<br>"
        f"<strong>金額</strong>：NT$ {total}</p>"
        f'<p><a href="{base}/shop/orders">查看訂單</a></p>'
    )
    try:
        enqueue_email(buyer_email, subject, html)
    except Exception as exc:
        logger.warning("shop.order_confirmed email failed: %s", exc)


async def _handle_announcement_published(db: AsyncSession, payload: dict) -> None:
    """公告發布後，對啟用 announcement email 偏好的用戶發送通知。"""
    from sqlalchemy import select

    from api.core.config import settings
    from api.models.user import User
    from api.services.mail import enqueue_email
    from api.services.notification_pref import normalize_preferences

    title = payload.get("title", "公告")
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    users = (await db.execute(select(User).where(User.is_active.is_(True)))).scalars().all()
    for user in users:
        if not user.email:
            continue
        prefs = normalize_preferences(user.notification_preferences or {})
        if prefs.get("announcement", {}).get("email"):
            subject = f"【新公告】{title}"
            html = (
                f"<p>平台新增公告：《{title}》</p>"
                f'<p><a href="{base}/announcements">查看公告</a></p>'
            )
            try:
                enqueue_email(user.email, subject, html)
            except Exception as exc:
                logger.warning("announcement.published email failed user=%s: %s", user.id, exc)


def _handle_petition_external_notify(payload: dict) -> None:
    """陳情案件回覆/狀態更新後，發送 email 至外部聯絡信箱（無帳號提交者）。"""
    from api.services.mail import enqueue_email

    contact_email = payload.get("contact_email", "")
    contact_name = payload.get("contact_name", "")
    title = payload.get("title", "")
    body = payload.get("body", "")
    if not contact_email:
        return
    subject = f"您的陳情案件有新進展：{title}"
    html = f"<p>親愛的 {contact_name or '陳情人'}，您的陳情案件有新進展：{body}</p>"
    try:
        enqueue_email(contact_email, subject, html)
    except Exception as exc:
        logger.warning("petition.external_notify email failed: %s", exc)


async def process_pending_outbox() -> None:
    """Claim pending events，提交 claim 後才進行外部 I/O。"""
    from api.core.database import task_session

    now = datetime.now(UTC)
    worker_id = uuid.uuid4().hex
    async with task_session() as db:
        rows = (
            (
                await db.execute(
                    select(OutboxEvent)
                    .where(OutboxEvent.status == OutboxStatus.PENDING)
                    .where(~OutboxEvent.event_type.like("discord.%"))
                    .where(
                        or_(
                            OutboxEvent.next_attempt_at.is_(None),
                            OutboxEvent.next_attempt_at <= now,
                        )
                    )
                    .where(
                        or_(
                            OutboxEvent.locked_until.is_(None),
                            OutboxEvent.locked_until < now,
                        )
                    )
                    .order_by(OutboxEvent.created_at)
                    .limit(_CLAIM_BATCH_SIZE)
                    .with_for_update(skip_locked=True)
                )
            )
            .scalars()
            .all()
        )
        claims: list[tuple[uuid.UUID, str]] = []
        lease_until = now + timedelta(seconds=_LEASE_SECONDS)
        for event in rows:
            event.locked_by = worker_id
            event.locked_until = lease_until
            claims.append((event.id, worker_id))
        await db.commit()

    for event_id, owner in claims:
        await _process_claimed_event(event_id, owner)


async def _process_claimed_event(event_id: uuid.UUID, owner: str) -> None:
    """處理單一 claim；row lock 只在 claim/finalize 交易中存在。"""
    from api.core.database import task_session

    async with task_session() as db:
        event = await db.scalar(
            select(OutboxEvent).where(
                OutboxEvent.id == event_id,
                OutboxEvent.locked_by == owner,
                OutboxEvent.status == OutboxStatus.PENDING,
            )
        )
        if event is None:
            return
        try:
            await _dispatch(db, event)
            event.status = OutboxStatus.PROCESSED
            event.processed_at = datetime.now(UTC)
            event.next_attempt_at = None
            event.locked_until = None
            event.locked_by = None
            await db.commit()
            record_outbox_delivery(event.event_type, "processed")
        except SQLAlchemyError:
            # DB transaction 失敗時保留 lease，待逾時後由下一個 worker 接手。
            await db.rollback()
            raise
        except Exception as exc:
            event_type = event.event_type
            retry_count = event.retry_count + 1
            await db.rollback()
            async with task_session() as update_db:
                current = await update_db.scalar(
                    select(OutboxEvent).where(
                        OutboxEvent.id == event_id,
                        OutboxEvent.locked_by == owner,
                        OutboxEvent.status == OutboxStatus.PENDING,
                    )
                )
                if current is None:
                    return
                current.retry_count = retry_count
                current.last_error = str(exc)
                current.locked_until = None
                current.locked_by = None
                if retry_count >= _MAX_RETRY:
                    current.status = OutboxStatus.DEAD
                    current.next_attempt_at = None
                    outcome = "dead"
                    logger.error(
                        "Outbox event %s dead after %d retries: %s",
                        event_id,
                        _MAX_RETRY,
                        exc,
                    )
                else:
                    current.next_attempt_at = datetime.now(UTC) + _retry_delay(retry_count)
                    outcome = "retry"
                    logger.warning(
                        "Outbox event %s failed (retry %d): %s", event_id, retry_count, exc
                    )
                await update_db.commit()
            record_outbox_delivery(event_type, outcome)


async def replay_dead_event(session: AsyncSession, event_id: uuid.UUID) -> OutboxEvent:
    """將 dead-letter 事件重設為 pending，供管理介面人工重播。"""
    event = await session.get(OutboxEvent, event_id)
    if event is None:
        raise LookupError("找不到此 outbox 事件")
    if event.status != OutboxStatus.DEAD:
        raise ValueError("只有 dead 事件可以重播")
    event.status = OutboxStatus.PENDING
    event.retry_count = 0
    event.last_error = None
    event.processed_at = None
    event.next_attempt_at = datetime.now(UTC)
    event.locked_until = None
    event.locked_by = None
    await session.flush()
    return event
