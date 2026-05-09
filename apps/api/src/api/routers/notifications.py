"""通知路由 — Email 發送 + 站內通知收件匣"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.notification import Notification
from api.models.user import User
from api.services.mail import enqueue_email

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


class NotificationPreferencesOut(BaseModel):
    model_config = ConfigDict(from_attributes=False)

    document_pending: bool = True
    document_approved: bool = True
    document_rejected: bool = True
    document_recalled: bool = True
    announcement: bool = True
    system: bool = True


class NotificationPreferencesIn(BaseModel):
    document_pending: bool | None = None
    document_approved: bool | None = None
    document_rejected: bool | None = None
    document_recalled: bool | None = None
    announcement: bool | None = None
    system: bool | None = None


# ── 站內通知收件匣 ────────────────────────────────────────────────────────────


@router.get("/inbox", response_model=list[NotificationOut], summary="取得我的通知列表")
async def list_notifications(
    db: DbDep,
    current_user: CurrentUser,
    unread_only: bool = False,
    limit: int = 50,
) -> list[NotificationOut]:
    stmt = (
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read == False)  # noqa: E712
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


# ── 通知偏好設定 ──────────────────────────────────────────────────────────────

_DEFAULT_PREFS = {
    "document_pending": True,
    "document_approved": True,
    "document_rejected": True,
    "document_recalled": True,
    "announcement": True,
    "system": True,
}


@router.get("/preferences", response_model=NotificationPreferencesOut, summary="取得我的通知偏好")
async def get_preferences(current_user: CurrentUser) -> NotificationPreferencesOut:
    prefs = {**_DEFAULT_PREFS, **(current_user.notification_preferences or {})}
    return NotificationPreferencesOut(**prefs)


@router.put("/preferences", response_model=NotificationPreferencesOut, summary="更新通知偏好")
async def update_preferences(
    body: NotificationPreferencesIn,
    db: DbDep,
    current_user: CurrentUser,
) -> NotificationPreferencesOut:
    existing = {**_DEFAULT_PREFS, **(current_user.notification_preferences or {})}
    updates = body.model_dump(exclude_none=True)
    merged = {**existing, **updates}
    current_user.notification_preferences = merged
    await db.flush()
    return NotificationPreferencesOut(**merged)


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
    """在 DB 建立站內通知（不 commit，由呼叫者控制 transaction）。
    若使用者已關閉該類型的通知偏好則靜默略過。
    """
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is not None:
        prefs = user.notification_preferences or {}
        if not prefs.get(type, True):
            return
    n = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        link=link,
        related_id=related_id,
    )
    db.add(n)
