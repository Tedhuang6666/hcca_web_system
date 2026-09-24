"""LINE Bot 服務 - 帳號綁定、通知推播與文字指令"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import unquote

from linebot.v3.exceptions import InvalidSignatureError
from linebot.v3.messaging import (
    ApiClient,
    Configuration,
    MessagingApi,
    PushMessageRequest,
    ReplyMessageRequest,
    TextMessage,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.core.security import redis_client
from api.models.line_account import LineAccountLink
from api.models.notification import Notification
from api.models.user import User
from api.services import announcement as announcement_svc
from api.services.announcement import ViewerScope
from api.services.permission import get_user_org_ids
from api.services.task_inbox import build_task_inbox

logger = logging.getLogger(__name__)

_line_config = Configuration(access_token=settings.LINE_CHANNEL_ACCESS_TOKEN or "placeholder")
_LINK_CODE_TTL_SECONDS = 10 * 60
_LINK_CODE_PREFIX = "line:link:"
_OPEN_TOKEN_TTL_SECONDS = 5 * 60
_OPEN_LINK_PREFIX = "line:open:"


def is_configured() -> bool:
    """回傳 LINE Bot 是否已完整設定。"""
    return bool(settings.LINE_CHANNEL_SECRET and settings.LINE_CHANNEL_ACCESS_TOKEN)


def _absolute_url(path: str | None) -> str:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    if not path:
        return base
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{base}{path if path.startswith('/') else '/' + path}"


def _safe_frontend_path(path: str | None) -> str:
    if not path:
        return "/"
    # 解碼 URL encoding 後再驗證，防止 /%2f%2fevil.com 繞過 // 前綴檢查
    decoded = unquote(path)
    if not decoded.startswith("/") or decoded.startswith("//"):
        return "/"
    return decoded


async def create_open_url(user_id: uuid.UUID, path: str | None) -> str:
    """建立 LINE 專用短效自動登入入口。"""
    token = secrets.token_urlsafe(32)
    await redis_client.setex(
        f"{_OPEN_LINK_PREFIX}{token}",
        _OPEN_TOKEN_TTL_SECONDS,
        json.dumps({"user_id": str(user_id), "path": _safe_frontend_path(path)}),
    )
    return _absolute_url(f"/line/open?token={token}")


async def consume_open_token(token: str) -> tuple[uuid.UUID, str] | None:
    """消耗一次性 LINE 自動登入 token。"""
    key = f"{_OPEN_LINK_PREFIX}{token}"
    raw = await redis_client.get(key)
    if not raw:
        return None
    await redis_client.delete(key)
    try:
        payload = json.loads(raw)
        return uuid.UUID(payload["user_id"]), _safe_frontend_path(payload.get("path"))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def verify_signature(body: str, signature: str) -> None:
    """驗證 LINE X-Line-Signature。"""
    digest = hmac.new(
        settings.LINE_CHANNEL_SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    if not hmac.compare_digest(expected, signature):
        raise InvalidSignatureError("Invalid LINE signature")


async def create_link_code(user_id: uuid.UUID) -> tuple[str, datetime]:
    """建立短效 LINE 綁定碼。

    安全：綁定碼一旦被猜中，攻擊者的 LINE 帳號就會綁到產碼者的平台帳號，再經
    /line/open 自動登入即可冒用該帳號。故使用 8 位數（1 億組）並搭配 _bind_line_user
    的 per-LINE-user 失敗鎖定，杜絕暴力猜碼接管帳號。沿用全數字以便在 LINE 內輸入。
    """
    expires_at = datetime.now(UTC) + timedelta(seconds=_LINK_CODE_TTL_SECONDS)
    for _ in range(10):
        code = f"{secrets.randbelow(100_000_000):08d}"
        key = f"{_LINK_CODE_PREFIX}{code}"
        created = await redis_client.set(
            key,
            json.dumps({"user_id": str(user_id)}, ensure_ascii=False),
            ex=_LINK_CODE_TTL_SECONDS,
            nx=True,
        )
        if created:
            return code, expires_at
    raise RuntimeError("LINE 綁定碼產生失敗，請稍後再試")


async def get_user_link(db: AsyncSession, user_id: uuid.UUID) -> LineAccountLink | None:
    result = await db.execute(
        select(LineAccountLink).where(
            LineAccountLink.user_id == user_id,
            LineAccountLink.is_active.is_(True),
        )
    )
    return result.scalar_one_or_none()


async def unlink_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    link = await get_user_link(db, user_id)
    if link is None:
        return
    link.is_active = False
    link.unlinked_at = datetime.now(UTC)
    await db.flush()


async def _unlink_line_user(db: AsyncSession, line_user_id: str) -> bool:
    result = await db.execute(
        select(LineAccountLink).where(
            LineAccountLink.line_user_id == line_user_id,
            LineAccountLink.is_active.is_(True),
        )
    )
    link = result.scalar_one_or_none()
    if link is None:
        return False
    link.is_active = False
    link.unlinked_at = datetime.now(UTC)
    await db.flush()
    return True


async def _get_any_user_link(db: AsyncSession, user_id: uuid.UUID) -> LineAccountLink | None:
    result = await db.execute(select(LineAccountLink).where(LineAccountLink.user_id == user_id))
    return result.scalar_one_or_none()


async def _get_any_line_link(db: AsyncSession, line_user_id: str) -> LineAccountLink | None:
    result = await db.execute(
        select(LineAccountLink).where(LineAccountLink.line_user_id == line_user_id)
    )
    return result.scalar_one_or_none()


async def _bind_line_user(
    db: AsyncSession,
    *,
    line_user_id: str,
    code: str,
    line_display_name: str | None = None,
) -> str:
    # per-LINE-user 失敗鎖定：限制單一 LINE 帳號的猜碼速率，封死暴力猜綁定碼接管帳號。
    from api.core.login_lockout import is_locked, record_failure, record_success

    lock_id = f"line_bind:{line_user_id}"
    locked = await is_locked(lock_id)
    if locked:
        return f"嘗試次數過多，請於 {locked // 60 + 1} 分鐘後再試。"

    key = f"{_LINK_CODE_PREFIX}{code.strip()}"
    raw = await redis_client.get(key)
    if not raw:
        await record_failure(lock_id)
        return "綁定碼無效或已過期，請回平台重新產生。"
    try:
        user_id = uuid.UUID(json.loads(raw)["user_id"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        await redis_client.delete(key)
        return "綁定碼格式異常，請回平台重新產生。"

    now = datetime.now(UTC)
    user_link = await _get_any_user_link(db, user_id)
    line_link = await _get_any_line_link(db, line_user_id)

    if line_link and user_link and line_link.id != user_link.id:
        await db.delete(user_link)
        await db.flush()

    link = line_link or user_link
    if link is None:
        link = LineAccountLink(
            user_id=user_id,
            line_user_id=line_user_id,
            line_display_name=line_display_name,
            is_active=True,
            linked_at=now,
        )
        db.add(link)
    else:
        link.user_id = user_id
        link.line_user_id = line_user_id
        link.line_display_name = line_display_name
        link.is_active = True
        link.linked_at = now
        link.unlinked_at = None
    await redis_client.delete(key)
    await db.flush()
    await record_success(lock_id)

    user = await db.get(User, user_id)
    name = user.display_name if user else "您的帳號"
    return f"綁定完成：{name}\n之後可輸入「學餐」、「我的餐」、「我的待辦」查詢。"


async def handle_webhook(body: str, signature: str) -> None:
    """驗證並處理 LINE webhook events。"""
    verify_signature(body, signature)
    payload = json.loads(body)
    for event in payload.get("events", []):
        if event.get("type") != "message":
            continue
        message = event.get("message") or {}
        if message.get("type") != "text":
            continue
        source = event.get("source") or {}
        line_user_id = source.get("userId")
        reply_token = event.get("replyToken")
        if not line_user_id or not reply_token:
            continue
        reply_text = await _handle_text_command(
            line_user_id=line_user_id,
            user_text=str(message.get("text") or ""),
        )
        await reply_text_message(reply_token, reply_text)


async def _current_user_for_line(db: AsyncSession, line_user_id: str) -> User | None:
    result = await db.execute(
        select(User)
        .join(LineAccountLink, LineAccountLink.user_id == User.id)
        .where(LineAccountLink.line_user_id == line_user_id)
        .where(LineAccountLink.is_active.is_(True))
        .where(User.is_active.is_(True))
    )
    return result.scalar_one_or_none()


def _help_text(bound: bool) -> str:
    lines = [
        "可用指令：",
        "未讀通知 / 我的待辦 / 今日會議 / 公告",
        "公文 / 法規 / 問卷 / 陳情 / 購票 - 開啟對應功能",
    ]
    if not bound:
        lines.insert(1, "綁定 123456 - 綁定平台帳號")
    else:
        lines.append("解除綁定 - 解除 LINE 帳號")
    return "\n".join(lines)


async def _handle_text_command(*, line_user_id: str, user_text: str) -> str:
    text = user_text.strip()
    if not text:
        return _help_text(bound=False)

    async with AsyncSessionLocal() as db:
        try:
            if text in {"說明", "help", "Help", "HELP"}:
                user = await _current_user_for_line(db, line_user_id)
                return _help_text(bound=user is not None)
            bind_match = re.fullmatch(r"綁定\s+([A-Za-z0-9]{6,12})", text)
            if bind_match:
                reply = await _bind_line_user(
                    db,
                    line_user_id=line_user_id,
                    code=bind_match.group(1),
                )
                await db.commit()
                return reply
            if text == "解除綁定":
                ok = await _unlink_line_user(db, line_user_id)
                await db.commit()
                return "已解除 LINE 綁定。" if ok else "這個 LINE 帳號尚未綁定平台帳號。"

            user = await _current_user_for_line(db, line_user_id)
            if user is None:
                return "請先登入平台產生綁定碼，再輸入「綁定 123456」。"

            if text == "我的待辦":
                return await _tasks_text(db, user)
            if text in {"公文", "待簽核"}:
                return await _module_tasks_text(db, user, "document", "公文", "/documents")
            if text == "法規":
                return await _module_tasks_text(db, user, "regulation", "法規", "/regulations")
            if text == "問卷":
                return await _module_tasks_text(db, user, "survey", "問卷", "/surveys")
            if text == "陳情":
                return await _module_tasks_text(db, user, "petition", "陳情", "/petitions")
            if text in {"購票", "商品"}:
                return f"開啟購票系統：\n{await create_open_url(user.id, '/shop')}"
            if text == "未讀通知":
                return await _unread_notifications_text(db, user)
            if text == "今日會議":
                return await _today_meetings_text(db, user)
            if text == "公告":
                return await _announcements_text(db, user)
            return _help_text(bound=True)
        except Exception:
            await db.rollback()
            logger.warning("LINE command failed text=%s user=%s", text, line_user_id, exc_info=True)
            return "處理時發生錯誤，請稍後再試。"


async def _tasks_text(db: AsyncSession, user: User) -> str:
    inbox = await build_task_inbox(db, user)
    if inbox.total == 0:
        return "目前沒有待辦事項。"
    lines = [f"待辦共 {inbox.total} 件："]
    for item in inbox.items[:5]:
        lines.append(f"- {item.title}\n  {await create_open_url(user.id, item.href)}")
    return "\n".join(lines)


async def _module_tasks_text(
    db: AsyncSession,
    user: User,
    module: str,
    label: str,
    fallback_path: str,
) -> str:
    inbox = await build_task_inbox(db, user)
    items = [item for item in inbox.items if item.module == module][:5]
    if not items:
        return f"目前沒有 {label} 待辦。\n{await create_open_url(user.id, fallback_path)}"
    lines = [f"{label}待辦："]
    for item in items:
        lines.append(f"- {item.title}\n  {await create_open_url(user.id, item.href)}")
    return "\n".join(lines)


async def _unread_notifications_text(db: AsyncSession, user: User) -> str:
    unread = int(
        await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id,
                Notification.is_read.is_(False),
                Notification.is_inapp_visible.is_(True),
            )
        )
        or 0
    )
    rows = (
        (
            await db.execute(
                select(Notification)
                .where(Notification.user_id == user.id)
                .where(Notification.is_read.is_(False))
                .where(Notification.is_inapp_visible.is_(True))
                .order_by(Notification.created_at.desc())
                .limit(3)
            )
        )
        .scalars()
        .all()
    )
    if unread == 0:
        return "目前沒有未讀通知。"
    lines = [f"未讀通知 {unread} 則："]
    for item in rows:
        lines.append(f"- {item.title}\n  {await create_open_url(user.id, item.link)}")
    return "\n".join(lines)


async def _today_meetings_text(db: AsyncSession, user: User) -> str:
    inbox = await build_task_inbox(db, user)
    meetings = [item for item in inbox.items if item.module == "meeting"][:5]
    if not meetings:
        return "接下來 72 小時沒有需要您出席的會議。"
    lines = ["近期會議："]
    for item in meetings:
        due = item.due_at.astimezone().strftime("%m/%d %H:%M") if item.due_at else ""
        lines.append(f"- {due} {item.title}\n  {await create_open_url(user.id, item.href)}")
    return "\n".join(lines)


async def _announcements_text(db: AsyncSession, user: User) -> str:
    org_ids = await get_user_org_ids(db, user.id)
    scope = ViewerScope(
        user_id=user.id,
        org_ids=frozenset(org_ids),
        is_school=user.email.rsplit("@", maxsplit=1)[-1].lower()
        in settings.LOGIN_ALLOWED_EMAIL_DOMAINS,
    )
    visible = await announcement_svc.list_announcements(db, scope=scope, limit=5)
    if not visible:
        return "目前沒有可見公告。"
    lines = ["最新公告："]
    for ann in visible:
        urgent = "【重要】" if ann.is_urgent else ""
        lines.append(
            f"- {urgent}{ann.title}\n  {await create_open_url(user.id, f'/announcements/{ann.id}')}"
        )
    return "\n".join(lines)


def _reply_text_message(reply_token: str, text: str) -> None:
    with ApiClient(_line_config) as api_client:
        MessagingApi(api_client).reply_message(
            ReplyMessageRequest(reply_token=reply_token, messages=[TextMessage(text=text[:4900])])
        )


async def reply_text_message(reply_token: str, text: str) -> None:
    if not is_configured():
        return
    await run_in_threadpool(_reply_text_message, reply_token, text)


def push_text_message(user_id: str, text: str) -> None:
    """同步推播文字訊息給指定 LINE userId，供 Celery/outbox 呼叫。"""
    if not is_configured():
        logger.warning("LINE Bot 未設定，跳過推播")
        return
    with ApiClient(_line_config) as api_client:
        MessagingApi(api_client).push_message(
            PushMessageRequest(to=user_id, messages=[TextMessage(text=text[:4900])])
        )
    logger.info("LINE 推播完成 to=%s", user_id)


__all__ = [
    "InvalidSignatureError",
    "create_link_code",
    "consume_open_token",
    "create_open_url",
    "get_user_link",
    "handle_webhook",
    "is_configured",
    "push_text_message",
    "unlink_user",
    "verify_signature",
]
