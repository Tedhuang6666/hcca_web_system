"""Outbox service — 寫入事件和處理器分派"""

from __future__ import annotations

import asyncio
import base64
import logging
import uuid
from datetime import UTC, datetime, timedelta
from html import escape as html_escape
from typing import Any

from sqlalchemy import event, or_, select
from sqlalchemy.engine import Connection
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, SessionTransaction

from api.core.prometheus_metrics import record_outbox_delivery
from api.models.outbox import OutboxEvent, OutboxStatus

logger = logging.getLogger(__name__)

_MAX_RETRY = 5
_CLAIM_BATCH_SIZE = 50
_LEASE_SECONDS = 300
_WAKE_AFTER_COMMIT = "notification_outbox_wake_after_commit"
_after_commit_tasks: set[asyncio.Task[None]] = set()


def request_processing_after_commit(session: AsyncSession) -> None:
    """通知意圖隨主交易提交後，喚醒既有 worker；輪詢仍是失敗恢復入口。"""
    session.info[_WAKE_AFTER_COMMIT] = True


async def _enqueue_after_commit() -> None:
    from api.services.outbox_tasks import process_outbox

    try:
        await asyncio.to_thread(process_outbox.delay)
    except Exception:
        # 意圖已提交，broker 不可用不能回頭使已成功的業務交易看起來失敗。
        logger.warning("Outbox 即時喚醒失敗，保留事件由週期處理恢復", exc_info=True)


@event.listens_for(Session, "after_commit")
def _wake_notification_outbox(session: Session) -> None:
    if session.in_nested_transaction() or not session.info.get(_WAKE_AFTER_COMMIT):
        return
    bind = session.get_bind()
    if isinstance(bind, Connection) and bind.in_transaction():
        # 外部 Connection 的交易尚未提交；Session.commit 可能只 RELEASE SAVEPOINT。
        # 此時不可讓 worker 讀取尚未提交的資料，外部提交後仍有耐久事件供輪詢。
        return
    session.info.pop(_WAKE_AFTER_COMMIT, None)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(_enqueue_after_commit())
    _after_commit_tasks.add(task)
    task.add_done_callback(_after_commit_tasks.discard)


@event.listens_for(Session, "after_transaction_end")
def _clear_notification_outbox_wake(session: Session, transaction: SessionTransaction) -> None:
    if transaction.parent is None:
        session.info.pop(_WAKE_AFTER_COMMIT, None)


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

    if etype in {
        "notification.websocket",
        "notification.web_push",
        "notification.email_batch",
    }:
        from api.services.notification import deliver_notification

        await deliver_notification(db, etype, payload)
    elif etype == "document.approved":
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
    elif etype == "regulation.published":
        await _handle_regulation_published(db, payload)
    elif etype == "shop.order_confirmed":
        _handle_shop_order_confirmed(payload)
    elif etype == "shop.class_payment_confirmed":
        _handle_shop_class_payment_confirmed(payload)
    elif etype == "announcement.published":
        await _handle_announcement_published(db, payload)
    elif etype == "petition.external_notify":
        await _handle_petition_external_notify(db, payload)
    elif etype == "notification.email_with_attachments":
        await _handle_notification_email_with_attachments(db, payload)
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
    subtotal = int(payload.get("subtotal_price", payload.get("total_price", 0)) or 0)
    discount = int(payload.get("discount_amount", 0) or 0)
    total = int(payload.get("total_price", max(0, subtotal - discount)) or 0)
    if not buyer_email or not serial:
        return
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    subject = f"【訂單確認】{serial}"
    item_rows = []
    for item in payload.get("items", []):
        if not isinstance(item, dict):
            continue
        name = html_escape(str(item.get("product_name") or "商品"))
        unit_price = int(item.get("unit_price", 0) or 0)
        quantity = int(item.get("quantity", 0) or 0)
        item_subtotal = int(item.get("subtotal", unit_price * quantity) or 0)
        options = [
            html_escape(str(option.get("value", "")))
            for option in item.get("selected_options", [])
            if isinstance(option, dict) and option.get("value")
        ]
        option_details = f"<br>規格：{'、'.join(options)}" if options else ""
        item_rows.append(
            f"<p><strong>{name}</strong><br>"
            f"單價：NT$ {unit_price:,}<br>"
            f"數量：{quantity}<br>"
            f"小計：NT$ {item_subtotal:,}{option_details}</p>"
        )
    items_html = "".join(item_rows) or "<p>訂單品項詳情請至「我的訂單」查看。</p>"
    promotion_code = html_escape(str(payload.get("promotion_code") or ""))
    discount_label = "優惠折抵" + (f"（{promotion_code}）" if promotion_code else "")
    buyer_greeting = html_escape(str(buyer_name or "同學"))
    html = (
        f"<p>親愛的 {buyer_greeting}，感謝您的訂購！</p>"
        f"<p><strong>訂單編號</strong>：{html_escape(str(serial))}</p>"
        f"<p><strong>商品明細</strong></p>{items_html}"
        f"<p><strong>金額明細</strong><br>"
        f"商品小計：NT$ {subtotal:,}<br>"
        f"{discount_label}：− NT$ {discount:,}<br>"
        f"<strong>應付總額：NT$ {total:,}</strong></p>"
        f'<p><a href="{base}/shop/orders">查看訂單</a></p>'
    )
    try:
        enqueue_email(buyer_email, subject, html)
    except Exception as exc:
        logger.warning("shop.order_confirmed email failed: %s", exc)


def _handle_shop_class_payment_confirmed(payload: dict) -> None:
    """班聯確認整班收款後，將該班訂購明細寄給班代。"""
    from api.core.config import settings
    from api.services.mail import enqueue_email

    cadre_emails = payload.get("cadre_emails", [])
    orders = payload.get("orders", [])
    if not isinstance(cadre_emails, list) or not isinstance(orders, list) or not orders:
        return

    raw_class_label = str(payload.get("class_label") or "班級")
    raw_activity_name = str(payload.get("activity_name") or "一般商品")
    total_amount = 0
    collected_count = 0
    order_rows = []
    for order in orders:
        if not isinstance(order, dict):
            continue
        total_price = int(order.get("total_price", 0) or 0)
        total_amount += total_price
        is_class_collected = bool(order.get("is_class_collected"))
        collected_count += int(is_class_collected)
        student_name = html_escape(str(order.get("student_name") or "同學"))
        student_id = html_escape(str(order.get("student_id") or ""))
        student_label = f"{student_name}（{student_id}）" if student_id else student_name
        serial_number = html_escape(str(order.get("serial_number") or ""))
        item_rows = []
        for item in order.get("items", []):
            if not isinstance(item, dict):
                continue
            product_name = html_escape(str(item.get("product_name") or "商品"))
            quantity = int(item.get("quantity", 0) or 0)
            subtotal = int(item.get("subtotal", 0) or 0)
            options = []
            for option in item.get("selected_options", []):
                if not isinstance(option, dict) or not option.get("value"):
                    continue
                value = html_escape(str(option["value"]))
                group_name = option.get("group_name")
                options.append(f"{html_escape(str(group_name))}：{value}" if group_name else value)
            option_text = f"（{'、'.join(options)}）" if options else ""
            item_rows.append(f"{product_name} × {quantity}{option_text}，NT$ {subtotal:,}")
        items_html = "<br>".join(item_rows) or "無商品明細"
        collection_status = "班代已收款" if is_class_collected else "班代尚未收款"
        order_rows.append(
            "<p>"
            f"<strong>學生</strong>：{student_label}<br>"
            f"<strong>訂單編號</strong>：{serial_number}<br>"
            f"<strong>訂購品項</strong><br>{items_html}<br>"
            f"<strong>金額</strong>：NT$ {total_price:,}<br>"
            f"{collection_status}"
            "</p>"
        )
    if not order_rows:
        return

    subject_label = " ".join(f"【{value}】" for value in (raw_class_label, raw_activity_name))
    subject_label = subject_label.replace("\r", " ").replace("\n", " ")
    subject = f"【班聯收款確認】{subject_label}"
    class_label = html_escape(raw_class_label)
    activity_name = html_escape(raw_activity_name)
    base = html_escape(settings.FRONTEND_BASE_URL.rstrip("/"), quote=True)
    html = (
        f"<p>班聯會已確認<strong>{class_label}</strong>的「{activity_name}」款項。</p>"
        f"<p>有效訂單 {len(order_rows)} 筆，訂購總額 NT$ {total_amount:,}；"
        f"班代已登記收款 {collected_count} 筆，尚未登記 {len(order_rows) - collected_count} 筆。</p>"
        f"{''.join(order_rows)}"
        f'<p><a href="{base}/shop/class-orders">查看班級訂單</a></p>'
    )
    for email in cadre_emails:
        if not isinstance(email, str) or not email.strip():
            continue
        try:
            enqueue_email(email.strip(), subject, html)
        except Exception:
            logger.warning(
                "shop.class_payment_confirmed email failed class=%s", class_label, exc_info=True
            )


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


async def _petition_email_attachments(
    db: AsyncSession, payload: dict[str, Any]
) -> list[dict[str, str]]:
    """只讀取指定案件中已公開的附件，並轉為郵件服務接受的格式。"""
    attachment_ids = payload.get("attachment_ids")
    if not isinstance(attachment_ids, list) or not attachment_ids:
        return []
    try:
        case_id = uuid.UUID(str(payload.get("related_id")))
        parsed_ids = [uuid.UUID(str(item)) for item in attachment_ids]
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError("陳情通知附件識別碼無效") from exc
    if len(set(parsed_ids)) != len(parsed_ids):
        raise ValueError("陳情通知附件識別碼重複")

    from api.models.petition import PetitionAttachment, PetitionAttachmentVisibility
    from api.services.storage import get_storage

    rows = (
        (
            await db.execute(
                select(PetitionAttachment).where(
                    PetitionAttachment.case_id == case_id,
                    PetitionAttachment.id.in_(parsed_ids),
                    PetitionAttachment.visibility == PetitionAttachmentVisibility.PUBLIC,
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {attachment.id: attachment for attachment in rows}
    if len(by_id) != len(parsed_ids):
        raise ValueError("陳情通知附件不存在或尚未公開")

    storage = get_storage()
    email_attachments: list[dict[str, str]] = []
    total_size = 0
    for attachment_id in parsed_ids:
        attachment = by_id[attachment_id]
        content = await storage.read_bytes(attachment.storage_key)
        total_size += len(content)
        if total_size > 20 * 1024 * 1024:
            raise ValueError("陳情通知附件總大小超過 20 MB")
        email_attachments.append(
            {
                "filename": attachment.display_name or attachment.filename,
                "content": base64.b64encode(content).decode("ascii"),
            }
        )
    return email_attachments


async def _handle_petition_external_notify(db: AsyncSession, payload: dict) -> None:
    """陳情案件回覆/狀態更新後，發送 email 至外部聯絡信箱（無帳號提交者）。"""
    from api.services.mail import enqueue_email

    contact_email = payload.get("contact_email", "")
    contact_name = str(payload.get("contact_name") or "陳情人")
    title = payload.get("title", "")
    body = str(payload.get("body") or "")
    if not contact_email:
        return
    subject = f"您的陳情案件有新進展：{title}"
    content_blocks = [
        f"<p>親愛的 {html_escape(contact_name)}，您的陳情案件有新進展。</p>",
        "<h3>案件資訊</h3>",
    ]
    section_labels = {"陳情內容：", "本次更新：", "公開回覆：", "回覆附件："}
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line in section_labels:
            content_blocks.append(f"<h3>{html_escape(line.rstrip('：'))}</h3>")
        elif "：" in line:
            label, value = line.split("：", 1)
            content_blocks.append(
                f"<p><strong>{html_escape(label)}：</strong>{html_escape(value)}</p>"
            )
        else:
            content_blocks.append(f"<p>{html_escape(line)}</p>")
    html = "".join(content_blocks)
    try:
        attachments = await _petition_email_attachments(db, payload)
        enqueue_email(
            contact_email,
            subject,
            html,
            "html",
            attachments=attachments or None,
        )
    except Exception as exc:
        logger.warning("petition.external_notify email failed: %s", exc)
        raise


async def _handle_notification_email_with_attachments(
    db: AsyncSession, payload: dict[str, Any]
) -> None:
    """寄出含回覆附件的品牌通知信，並沿用使用者退訂資訊。"""
    from api.core.config import settings
    from api.email.renderer import make_unsubscribe_token
    from api.email.sender import send_branded_email
    from api.models.user import User
    from api.services.notification_pref import TYPE_LABELS, normalize_preferences

    try:
        user_id = uuid.UUID(str(payload.get("user_id")))
    except (TypeError, ValueError, AttributeError):
        logger.warning("通知附件 Email 缺少有效 user_id")
        return
    user = await db.get(User, user_id)
    if user is None or not user.is_active or not user.email:
        return

    notification_type = str(payload.get("type") or "")
    preferences = normalize_preferences(user.notification_preferences or {})
    if not preferences.get(notification_type, {}).get("email", False):
        return

    title = str(payload.get("title") or "陳情案件更新")
    body = str(payload.get("body") or "")
    link = payload.get("link")
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    attachments = await _petition_email_attachments(db, payload)
    send_branded_email(
        to=[str(user.email)],
        subject=f"【{TYPE_LABELS.get(notification_type, '通知')}】{title}",
        template="notification",
        context={
            "heading": title,
            "body_text": body,
            "preview_text": (body or title)[:80],
            "cta_url": f"{base}{link}" if link else "",
            "cta_label": "前往查看",
            "unsubscribe_url": (
                f"{base}/unsubscribe?token={make_unsubscribe_token(user.id, notification_type)}"
            ),
        },
        attachments=attachments or None,
        recipient_metadata=[
            {"user_id": str(user.id), "email": str(user.email), "name": user.display_name}
        ],
        source="notification",
    )


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
