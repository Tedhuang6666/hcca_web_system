"""通知路由 — Email 發送 + 站內通知收件匣 + 通知偏好（站內 / Email 多管道）"""

import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from itsdangerous import BadData
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.email.renderer import make_unsubscribe_token, parse_unsubscribe_token
from api.email.sender import send_branded_email
from api.models.notification import Notification
from api.models.user import User
from api.models.web_push import WebPushSubscription
from api.services.mail import enqueue_email
from api.services.notification_pref import (
    DIGEST_FREQUENCIES,
    TYPE_LABELS,
    get_digest_frequency,
    normalize_preferences,
    set_digest_frequency,
)
from api.services.web_push import send_to_user, web_push_enabled

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["通知"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── Pydantic Schemas ──────────────────────────────────────────────────────────


class EmailRequest(BaseModel):
    to: list[EmailStr]
    subject: str
    body: str
    subtype: str = "html"


class TaskEnqueuedResponse(BaseModel):
    task_id: str
    status: str = "queued"
    message: str


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    title: str
    body: str | None
    link: str | None
    is_read: bool
    related_id: uuid.UUID | None
    created_at: str

    @classmethod
    def from_orm_dt(cls, n: Notification) -> "NotificationOut":
        return cls(
            id=n.id,
            type=n.type,
            title=n.title,
            body=n.body,
            link=n.link,
            is_read=n.is_read,
            related_id=n.related_id,
            created_at=n.created_at.isoformat(),
        )


class NotificationCountOut(BaseModel):
    unread: int
    total: int


class ChannelPref(BaseModel):
    """單一通知類型的接收管道設定。"""

    inapp: bool = True
    email: bool = False
    line: bool = False
    discord: bool = False


class NotificationPreferencesOut(BaseModel):
    document_pending: ChannelPref
    document_approved: ChannelPref
    document_rejected: ChannelPref
    document_recalled: ChannelPref
    meeting_invited: ChannelPref
    meeting_today: ChannelPref
    meeting_minutes_ready: ChannelPref
    regulation_review_assigned: ChannelPref
    regulation_publish_ready: ChannelPref
    regulation_published: ChannelPref
    petition_assigned: ChannelPref
    petition_replied: ChannelPref
    petition_status_updated: ChannelPref
    meal_class_collecting: ChannelPref
    meal_pickup_ready: ChannelPref
    shop_order_paid: ChannelPref
    survey_invitation: ChannelPref
    announcement: ChannelPref
    calendar_event_invited: ChannelPref
    calendar_event_updated: ChannelPref
    work_item_assigned: ChannelPref
    work_item_due: ChannelPref
    system: ChannelPref


class NotificationPreferencesIn(BaseModel):
    document_pending: ChannelPref | None = None
    document_approved: ChannelPref | None = None
    document_rejected: ChannelPref | None = None
    document_recalled: ChannelPref | None = None
    meeting_invited: ChannelPref | None = None
    meeting_today: ChannelPref | None = None
    meeting_minutes_ready: ChannelPref | None = None
    regulation_review_assigned: ChannelPref | None = None
    regulation_publish_ready: ChannelPref | None = None
    regulation_published: ChannelPref | None = None
    petition_assigned: ChannelPref | None = None
    petition_replied: ChannelPref | None = None
    petition_status_updated: ChannelPref | None = None
    meal_class_collecting: ChannelPref | None = None
    meal_pickup_ready: ChannelPref | None = None
    shop_order_paid: ChannelPref | None = None
    survey_invitation: ChannelPref | None = None
    announcement: ChannelPref | None = None
    calendar_event_invited: ChannelPref | None = None
    calendar_event_updated: ChannelPref | None = None
    work_item_assigned: ChannelPref | None = None
    work_item_due: ChannelPref | None = None
    system: ChannelPref | None = None


class UnsubscribeRequest(BaseModel):
    token: str


class WebPushKeys(BaseModel):
    p256dh: str
    auth: str


class WebPushSubscriptionIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    endpoint: str
    push_keys: WebPushKeys = Field(alias="keys")
    device_label: str | None = None


class WebPushSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    endpoint: str
    device_label: str | None
    is_active: bool


class WebPushConfigOut(BaseModel):
    enabled: bool
    public_key: str


# ── 站內通知收件匣 ────────────────────────────────────────────────────────────


@router.get("/inbox", response_model=list[NotificationOut], summary="取得我的通知列表")
async def list_notifications(
    db: DbDep,
    current_user: CurrentUser,
    unread_only: bool = False,
    date_from: date | None = Query(None, description="起始日期"),
    date_to: date | None = Query(None, description="結束日期"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[NotificationOut]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read == False)  # noqa: E712
    if date_from:
        stmt = stmt.where(
            Notification.created_at
            >= datetime(date_from.year, date_from.month, date_from.day, tzinfo=UTC)
        )
    if date_to:
        stmt = stmt.where(
            Notification.created_at
            < datetime(date_to.year, date_to.month, date_to.day, tzinfo=UTC) + timedelta(days=1)
        )
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    notifications = result.scalars().all()
    return [NotificationOut.from_orm_dt(n) for n in notifications]


@router.get("/inbox/count", response_model=NotificationCountOut, summary="取得未讀數")
async def count_notifications(db: DbDep, current_user: CurrentUser) -> NotificationCountOut:
    from sqlalchemy import func

    total_q = await db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == current_user.id)
    )
    unread_q = await db.scalar(
        select(func.count(Notification.id))
        .where(Notification.user_id == current_user.id)
        .where(Notification.is_read == False)  # noqa: E712
    )
    return NotificationCountOut(unread=int(unread_q or 0), total=int(total_q or 0))


@router.patch(
    "/inbox/{notification_id}/read", response_model=NotificationOut, summary="標記單則為已讀"
)
async def mark_read(
    notification_id: uuid.UUID,
    db: DbDep,
    current_user: CurrentUser,
) -> NotificationOut:
    result = await db.execute(
        select(Notification)
        .where(Notification.id == notification_id)
        .where(Notification.user_id == current_user.id)
    )
    n = result.scalar_one_or_none()
    if not n:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="通知不存在")
    n.is_read = True
    await db.flush()
    return NotificationOut.from_orm_dt(n)


@router.post("/inbox/read-all", summary="全部標記為已讀")
async def mark_all_read(db: DbDep, current_user: CurrentUser) -> dict[str, int]:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id)
        .where(Notification.is_read == False)  # noqa: E712
        .values(is_read=True)
        .returning(Notification.id)
    )
    count = len(result.fetchall())
    return {"marked_read": count}


# ── 通知偏好設定（多管道：站內 / Email）──────────────────────────────────────


@router.get("/preferences", response_model=NotificationPreferencesOut, summary="取得我的通知偏好")
async def get_preferences(current_user: CurrentUser) -> NotificationPreferencesOut:
    normalized = normalize_preferences(current_user.notification_preferences)
    return NotificationPreferencesOut(**normalized)


@router.put("/preferences", response_model=NotificationPreferencesOut, summary="更新通知偏好")
async def update_preferences(
    body: NotificationPreferencesIn,
    db: DbDep,
    current_user: CurrentUser,
) -> NotificationPreferencesOut:
    merged = normalize_preferences(current_user.notification_preferences)
    for ntype, channel in body.model_dump(exclude_none=True).items():
        merged[ntype] = {
            "inapp": bool(channel["inapp"]),
            "email": bool(channel["email"]),
            "line": bool(channel["line"]),
            "discord": bool(channel["discord"]),
        }
    current_user.notification_preferences = merged
    await db.flush()
    return NotificationPreferencesOut(**merged)


class DigestPreferenceOut(BaseModel):
    frequency: str = Field(..., description="off / daily / weekly")


class DigestPreferenceIn(BaseModel):
    frequency: str = Field(..., description="off / daily / weekly")


@router.get(
    "/preferences/digest",
    response_model=DigestPreferenceOut,
    summary="取得我的 Email 摘要頻率",
)
async def get_digest_preference(current_user: CurrentUser) -> DigestPreferenceOut:
    return DigestPreferenceOut(
        frequency=get_digest_frequency(current_user.notification_preferences)
    )


@router.put(
    "/preferences/digest",
    response_model=DigestPreferenceOut,
    summary="更新我的 Email 摘要頻率",
)
async def update_digest_preference(
    body: DigestPreferenceIn,
    db: DbDep,
    current_user: CurrentUser,
) -> DigestPreferenceOut:
    if body.frequency not in DIGEST_FREQUENCIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"frequency 須為 {', '.join(DIGEST_FREQUENCIES)}",
        )
    current_user.notification_preferences = set_digest_frequency(
        current_user.notification_preferences, body.frequency
    )
    await db.flush()
    return DigestPreferenceOut(frequency=body.frequency)


@router.get("/web-push/config", response_model=WebPushConfigOut, summary="取得 Web Push 設定")
async def web_push_config() -> WebPushConfigOut:
    return WebPushConfigOut(enabled=web_push_enabled(), public_key=settings.VAPID_PUBLIC_KEY)


@router.post(
    "/web-push/subscriptions",
    response_model=WebPushSubscriptionOut,
    summary="登錄瀏覽器 Web Push subscription",
)
async def save_web_push_subscription(
    body: WebPushSubscriptionIn,
    request: Request,
    db: DbDep,
    current_user: CurrentUser,
) -> WebPushSubscriptionOut:
    existing = (
        await db.execute(
            select(WebPushSubscription)
            .where(WebPushSubscription.user_id == current_user.id)
            .where(WebPushSubscription.endpoint == body.endpoint)
        )
    ).scalar_one_or_none()
    if existing is None:
        existing = WebPushSubscription(user_id=current_user.id, endpoint=body.endpoint)
        db.add(existing)
    existing.p256dh = body.push_keys.p256dh
    existing.auth = body.push_keys.auth
    existing.device_label = body.device_label
    existing.user_agent = request.headers.get("user-agent")
    existing.is_active = True
    await db.flush()
    return WebPushSubscriptionOut.model_validate(existing)


@router.get(
    "/web-push/subscriptions",
    response_model=list[WebPushSubscriptionOut],
    summary="列出我的 Web Push subscriptions",
)
async def list_web_push_subscriptions(
    db: DbDep, current_user: CurrentUser
) -> list[WebPushSubscriptionOut]:
    rows = (
        await db.execute(
            select(WebPushSubscription)
            .where(WebPushSubscription.user_id == current_user.id)
            .order_by(WebPushSubscription.created_at.desc())
        )
    ).scalars()
    return [WebPushSubscriptionOut.model_validate(row) for row in rows]


@router.delete("/web-push/subscriptions/{subscription_id}", summary="停用 Web Push subscription")
async def delete_web_push_subscription(
    subscription_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> None:
    sub = (
        await db.execute(
            select(WebPushSubscription)
            .where(WebPushSubscription.id == subscription_id)
            .where(WebPushSubscription.user_id == current_user.id)
        )
    ).scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="subscription 不存在")
    sub.is_active = False
    await db.flush()


@router.post("/web-push/test", summary="測試推播至目前使用者")
async def test_web_push(db: DbDep, current_user: CurrentUser) -> dict[str, int]:
    sent = await send_to_user(
        db,
        current_user.id,
        {"title": "HCCA 推播測試", "body": "你的瀏覽器通知已成功啟用。", "url": "/notifications"},
    )
    return {"sent": sent}


@router.post("/unsubscribe", summary="透過 Email 退訂連結關閉某類 Email 通知（免登入）")
async def unsubscribe_via_token(body: UnsubscribeRequest, db: DbDep) -> dict[str, str]:
    """退訂連結端點：驗證簽章 token 後關閉該使用者該類型的 Email 管道。"""
    try:
        user_id, ntype = parse_unsubscribe_token(body.token)
    except (BadData, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="退訂連結無效或已失效"
        ) from exc
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="使用者不存在")
    prefs = normalize_preferences(user.notification_preferences)
    if ntype in prefs:
        prefs[ntype]["email"] = False
    user.notification_preferences = prefs
    await db.flush()
    return {
        "status": "ok",
        "type": ntype,
        "message": f"已關閉「{TYPE_LABELS.get(ntype, ntype)}」的 Email 通知",
    }


# ── Email 發送（原有功能保留）────────────────────────────────────────────────


@router.post("/email", response_model=TaskEnqueuedResponse, summary="發送 Email（Celery 背景任務）")
async def send_email_notification(
    payload: EmailRequest,
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_permission(PermissionCode.ADMIN_ALL)),
) -> TaskEnqueuedResponse:
    """將郵件推入 Celery 佇列後立即回應，實際發送由 Worker 處理。"""
    task_id = enqueue_email(
        to=[str(e) for e in payload.to],
        subject=payload.subject,
        body=payload.body,
        subtype=payload.subtype,
    )
    return TaskEnqueuedResponse(
        task_id=task_id,
        message=f"郵件任務已排入佇列，將發送至 {len(payload.to)} 位收件人",
    )


@router.get("/tasks/{task_id}", summary="查詢 Celery 任務狀態")
async def get_task_status(
    task_id: str,
    _: User = Depends(get_current_active_user),
    __: object = Depends(require_permission(PermissionCode.ADMIN_ALL)),
) -> dict[str, object]:
    from celery.result import AsyncResult

    from api.core.celery_app import celery_app

    result: AsyncResult = celery_app.AsyncResult(task_id)
    return {"task_id": task_id, "status": result.status}


# ── 工具函式（供其他 router 呼叫）────────────────────────────────────────────


def _send_notification_email(
    user: User, ntype: str, title: str, body: str | None, link: str | None
) -> None:
    """渲染品牌通知信並排入寄送佇列（含退訂連結）。"""
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    token = make_unsubscribe_token(user.id, ntype)
    send_branded_email(
        to=[user.email],
        subject=f"【{TYPE_LABELS.get(ntype, '通知')}】{title}",
        template="notification",
        context={
            "heading": title,
            "body_text": body or "",
            "preview_text": (body or title)[:80],
            "cta_url": f"{base}{link}" if link else "",
            "cta_label": "前往查看",
            "unsubscribe_url": f"{base}/unsubscribe?token={token}",
        },
    )


async def create_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    related_id: uuid.UUID | None = None,
) -> None:
    """依使用者偏好建立站內通知並（若開啟）寄送品牌 Email。

    不 commit，由呼叫者控制 transaction。站內與 Email 兩管道分別依
    notification_preferences 判定；Email 排程失敗只記錄、不影響業務交易。
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        return
    channel = normalize_preferences(user.notification_preferences).get(
        type, {"inapp": True, "email": False}
    )
    if channel["inapp"]:
        db.add(
            Notification(
                user_id=user_id,
                type=type,
                title=title,
                body=body,
                link=link,
                related_id=related_id,
            )
        )
    if channel["email"] and user.email:
        try:
            _send_notification_email(user, type, title, body, link)
        except Exception:
            logger.warning("通知 Email 排程失敗 user=%s type=%s", user_id, type, exc_info=True)
    if channel.get("line"):
        try:
            from api.models.line_account import LineAccountLink
            from api.services.outbox import emit

            line_user_id = await db.scalar(
                select(LineAccountLink.line_user_id).where(
                    LineAccountLink.user_id == user_id,
                    LineAccountLink.is_active.is_(True),
                )
            )
            if line_user_id:
                await emit(
                    db,
                    event_type="line.push",
                    payload={
                        "line_user_id": line_user_id,
                        "title": title,
                        "body": body,
                        "link": link,
                    },
                )
        except Exception:
            logger.warning("通知 LINE 排程失敗 user=%s type=%s", user_id, type, exc_info=True)
    if channel.get("discord"):
        try:
            from api.models.discord_account import DiscordAccountLink
            from api.services.outbox import emit

            discord_user_id = await db.scalar(
                select(DiscordAccountLink.discord_user_id).where(
                    DiscordAccountLink.user_id == user_id,
                    DiscordAccountLink.is_active.is_(True),
                )
            )
            if discord_user_id:
                await emit(
                    db,
                    event_type="discord.push",
                    payload={
                        "discord_user_id": discord_user_id,
                        "title": title,
                        "body": body,
                        "link": link,
                    },
                )
        except Exception:
            logger.warning("通知 Discord 排程失敗 user=%s type=%s", user_id, type, exc_info=True)
