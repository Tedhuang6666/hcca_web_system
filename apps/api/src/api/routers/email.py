"""電子郵件路由 — 平台寄信頁（收件人選擇 / 預覽 / 草稿 / 預約 / 寄送 / 紀錄）。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.email.sender import enqueue_rendered, render_generic_message
from api.models.email_message import EmailMessage, EmailStatus
from api.models.user import User
from api.services import audit as audit_svc
from api.services.permission import get_user_permission_codes
from api.services.recipient import resolve_recipients, spec_to_resolve_kwargs

router = APIRouter(prefix="/email", tags=["電子郵件"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
# 任一 email 權限即可進入寄信功能；批次寄送另在 handler 內二段檢查
EmailUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.EMAIL_SEND,
            PermissionCode.EMAIL_SEND_BULK,
            PermissionCode.ADMIN_ALL,
        )
    ),
]

_TPE = ZoneInfo("Asia/Taipei")
_EDITABLE = {EmailStatus.DRAFT, EmailStatus.SCHEDULED}
_SAMPLE_LIMIT = 5


# ── Schemas ───────────────────────────────────────────────────────────────────


class RecipientSelector(BaseModel):
    """收件人選擇條件（可混合）。

    include_all：全部使用者（含校外/管理員帳號）；
    include_school：全部校內使用者（email 屬校內網域）。
    """

    user_ids: list[uuid.UUID] = []
    position_ids: list[uuid.UUID] = []
    org_ids: list[uuid.UUID] = []
    include_all: bool = False
    include_school: bool = False


class CardRow(BaseModel):
    label: str = Field(min_length=1, max_length=50)
    value: str = Field(min_length=1, max_length=200)


class EmailComposePayload(BaseModel):
    """寄信內容（預覽 / 草稿 / 寄送共用）。"""

    subject: str = Field(min_length=1, max_length=255)
    heading: str = Field(default="", max_length=200)
    body: str = ""  # 富文本 HTML（渲染時以 bleach 清洗）
    card_rows: list[CardRow] = []
    cta_label: str = Field(default="", max_length=40)
    cta_url: str = Field(default="", max_length=500)
    recipients: RecipientSelector = RecipientSelector()


class EmailMessageCreate(EmailComposePayload):
    action: Literal["draft", "schedule", "send"] = "draft"
    scheduled_at: datetime | None = None


class EmailMessageUpdate(BaseModel):
    """草稿/預約編輯，所有欄位 Optional。"""

    subject: str | None = Field(default=None, max_length=255)
    heading: str | None = Field(default=None, max_length=200)
    body: str | None = None
    card_rows: list[CardRow] | None = None
    cta_label: str | None = Field(default=None, max_length=40)
    cta_url: str | None = Field(default=None, max_length=500)
    recipients: RecipientSelector | None = None
    scheduled_at: datetime | None = None


class RecipientPreviewOut(BaseModel):
    recipient_count: int
    sample_names: list[str]
    truncated: bool


class EmailPreviewOut(BaseModel):
    html: str


class EmailMessageOut(BaseModel):
    id: uuid.UUID
    sender_id: uuid.UUID | None
    sender_name: str | None
    subject: str
    template: str
    recipient_count: int
    status: str
    scheduled_at: datetime | None
    created_at: datetime
    updated_at: datetime


class EmailMessageDetailOut(EmailMessageOut):
    heading: str
    body: str
    card_rows: list[dict]
    cta_label: str
    cta_url: str
    recipient_spec: dict
    resolved_emails: list[str]
    error_detail: str | None


class TestSendOut(BaseModel):
    status: str
    sent_to: str


# ── 內部輔助 ──────────────────────────────────────────────────────────────────


def _to_utc(dt: datetime) -> datetime:
    """把（可能為 naive 的）時間正規化為 aware UTC；naive 視為 Asia/Taipei。"""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_TPE)
    return dt.astimezone(UTC)


def _spec_from_selector(sel: RecipientSelector) -> dict:
    return {
        "user_ids": [str(x) for x in sel.user_ids],
        "position_ids": [str(x) for x in sel.position_ids],
        "org_ids": [str(x) for x in sel.org_ids],
        "include_all": sel.include_all,
        "include_school": sel.include_school,
    }


def _is_bulk(sel: RecipientSelector) -> bool:
    return bool(sel.position_ids or sel.org_ids or sel.include_all or sel.include_school)


async def _ensure_can_send(db: AsyncSession, user: User, sel: RecipientSelector) -> None:
    """二段權限檢查：寄給職位 / 組織 / 全體需 email:send_bulk。"""
    if not _is_bulk(sel) or user.is_superuser:
        return
    codes = await get_user_permission_codes(db, user.id)
    if PermissionCode.EMAIL_SEND_BULK not in codes and PermissionCode.ADMIN_ALL not in codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="寄送給職位、機關全體或全平台需要「批次寄送 Email」權限（email:send_bulk）",
        )


async def _check_quota(db: AsyncSession, user: User, count: int) -> None:
    """每日寄送人次配額檢查。"""
    if user.is_superuser:
        return
    today = datetime.now(UTC).date()
    day_start = datetime(today.year, today.month, today.day, tzinfo=UTC)
    used = await db.scalar(
        select(func.coalesce(func.sum(EmailMessage.recipient_count), 0)).where(
            EmailMessage.sender_id == user.id,
            EmailMessage.status.in_([EmailStatus.QUEUED, EmailStatus.SENT]),
            EmailMessage.created_at >= day_start,
        )
    )
    quota = settings.EMAIL_DAILY_QUOTA_PER_USER
    if int(used or 0) + count > quota:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"超過每日寄送上限（{quota} 人次），今日已使用 {int(used or 0)} 人次",
        )


def _apply_compose(msg: EmailMessage, payload: EmailComposePayload) -> None:
    msg.subject = payload.subject
    msg.body = payload.body
    msg.template = "generic"
    msg.context = {
        "heading": payload.heading,
        "card_rows": [r.model_dump() for r in payload.card_rows],
        "cta_url": payload.cta_url,
        "cta_label": payload.cta_label,
    }
    msg.recipient_spec = _spec_from_selector(payload.recipients)


async def _send_now(db: AsyncSession, user: User, msg: EmailMessage) -> None:
    """解析收件人、配額檢查、渲染、逐封排入寄送佇列，並更新 msg 狀態。"""
    _users, emails = await resolve_recipients(
        db, **spec_to_resolve_kwargs(msg.recipient_spec or {})
    )
    if not emails:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="解析後無有效收件人"
        )
    await _check_quota(db, user, len(emails))
    html = render_generic_message(msg.subject, msg.body, msg.context or {})
    task_ids = enqueue_rendered(emails, msg.subject, html)
    msg.resolved_emails = emails
    msg.recipient_count = len(emails)
    msg.status = EmailStatus.QUEUED
    msg.celery_task_id = task_ids[0] if task_ids else None
    msg.scheduled_at = None
    msg.error_detail = None


def _to_out(msg: EmailMessage, sender_name: str | None) -> EmailMessageOut:
    return EmailMessageOut(
        id=msg.id,
        sender_id=msg.sender_id,
        sender_name=sender_name,
        subject=msg.subject,
        template=msg.template,
        recipient_count=msg.recipient_count,
        status=msg.status,
        scheduled_at=msg.scheduled_at,
        created_at=msg.created_at,
        updated_at=msg.updated_at,
    )


def _to_detail(
    msg: EmailMessage, sender_name: str | None, *, can_view_emails: bool
) -> EmailMessageDetailOut:
    ctx = msg.context or {}
    return EmailMessageDetailOut(
        **_to_out(msg, sender_name).model_dump(),
        heading=str(ctx.get("heading", "")),
        body=msg.body,
        card_rows=list(ctx.get("card_rows", [])),
        cta_label=str(ctx.get("cta_label", "")),
        cta_url=str(ctx.get("cta_url", "")),
        recipient_spec=msg.recipient_spec or {},
        resolved_emails=list(msg.resolved_emails or []) if can_view_emails else [],
        error_detail=msg.error_detail,
    )


async def _audit(db: AsyncSession, user: User, msg: EmailMessage, action: str) -> None:
    await audit_svc.record(
        db,
        entity_type="email_message",
        entity_id=str(msg.id),
        action=action,
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"status": msg.status, "recipient_count": msg.recipient_count},
        summary=f"電子郵件「{msg.subject}」（{action}）",
    )


async def _get_owned_message(
    db: AsyncSession, message_id: uuid.UUID, user: User
) -> EmailMessage:
    msg = await db.get(EmailMessage, message_id)
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="郵件不存在")
    if msg.sender_id != user.id and not user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無法操作他人的郵件")
    return msg


# ── 端點 ──────────────────────────────────────────────────────────────────────


@router.post(
    "/preview-recipients", response_model=RecipientPreviewOut, summary="解析收件人數量預覽"
)
async def preview_recipients(
    body: RecipientSelector, db: DbDep, user: EmailUser
) -> RecipientPreviewOut:
    await _ensure_can_send(db, user, body)
    users, emails = await resolve_recipients(
        db,
        user_ids=body.user_ids,
        position_ids=body.position_ids,
        org_ids=body.org_ids,
        include_all=body.include_all,
        include_school=body.include_school,
    )
    return RecipientPreviewOut(
        recipient_count=len(emails),
        sample_names=[u.display_name for u in users[:_SAMPLE_LIMIT]],
        truncated=len(users) > _SAMPLE_LIMIT,
    )


@router.post("/preview", response_model=EmailPreviewOut, summary="渲染品牌信件預覽 HTML")
async def preview_email(body: EmailComposePayload, user: EmailUser) -> EmailPreviewOut:
    html = render_generic_message(
        body.subject,
        body.body,
        {
            "heading": body.heading,
            "card_rows": [r.model_dump() for r in body.card_rows],
            "cta_url": body.cta_url,
            "cta_label": body.cta_label,
        },
    )
    return EmailPreviewOut(html=html)


@router.post(
    "/test", response_model=TestSendOut, summary="測試寄送：渲染後只寄給自己（不計配額）"
)
async def test_send(body: EmailComposePayload, user: EmailUser) -> TestSendOut:
    if not user.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="您的帳號沒有 Email"
        )
    html = render_generic_message(
        body.subject,
        body.body,
        {
            "heading": body.heading,
            "card_rows": [r.model_dump() for r in body.card_rows],
            "cta_url": body.cta_url,
            "cta_label": body.cta_label,
        },
    )
    enqueue_rendered([user.email], f"[測試] {body.subject}", html)
    return TestSendOut(status="queued", sent_to=user.email)


@router.post(
    "/messages",
    response_model=EmailMessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立郵件（draft 草稿 / schedule 預約 / send 立即寄送）",
)
async def create_message(body: EmailMessageCreate, db: DbDep, user: EmailUser) -> EmailMessageOut:
    await _ensure_can_send(db, user, body.recipients)
    msg = EmailMessage(sender_id=user.id)
    _apply_compose(msg, body)

    if body.action == "draft":
        msg.status = EmailStatus.DRAFT
    elif body.action == "schedule":
        if body.scheduled_at is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="預約寄送需指定時間"
            )
        scheduled = _to_utc(body.scheduled_at)
        if scheduled <= datetime.now(UTC):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="預約時間必須為未來時間"
            )
        msg.status = EmailStatus.SCHEDULED
        msg.scheduled_at = scheduled
    else:  # send
        await _send_now(db, user, msg)

    db.add(msg)
    await db.flush()
    await _audit(db, user, msg, body.action)
    await db.refresh(msg)
    return _to_out(msg, user.display_name)


@router.patch(
    "/messages/{message_id}", response_model=EmailMessageOut, summary="編輯草稿 / 預約郵件"
)
async def update_message(
    message_id: uuid.UUID, body: EmailMessageUpdate, db: DbDep, user: EmailUser
) -> EmailMessageOut:
    msg = await _get_owned_message(db, message_id, user)
    if msg.status not in _EDITABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="只有草稿或預約中的郵件可以編輯"
        )
    if body.subject is not None:
        msg.subject = body.subject
    if body.body is not None:
        msg.body = body.body
    ctx = dict(msg.context or {})
    if body.heading is not None:
        ctx["heading"] = body.heading
    if body.card_rows is not None:
        ctx["card_rows"] = [r.model_dump() for r in body.card_rows]
    if body.cta_url is not None:
        ctx["cta_url"] = body.cta_url
    if body.cta_label is not None:
        ctx["cta_label"] = body.cta_label
    msg.context = ctx
    if body.recipients is not None:
        await _ensure_can_send(db, user, body.recipients)
        msg.recipient_spec = _spec_from_selector(body.recipients)
    if body.scheduled_at is not None:
        scheduled = _to_utc(body.scheduled_at)
        if msg.status == EmailStatus.SCHEDULED and scheduled <= datetime.now(UTC):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="預約時間必須為未來時間"
            )
        msg.scheduled_at = scheduled
    await db.flush()
    await db.refresh(msg)
    return _to_out(msg, user.display_name)


@router.post(
    "/messages/{message_id}/send", response_model=EmailMessageOut, summary="將草稿/預約立即寄出"
)
async def send_message(
    message_id: uuid.UUID, db: DbDep, user: EmailUser
) -> EmailMessageOut:
    msg = await _get_owned_message(db, message_id, user)
    if msg.status not in _EDITABLE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="此郵件已寄出或已取消，無法再次寄送"
        )
    spec = RecipientSelector(**spec_to_resolve_kwargs(msg.recipient_spec or {}))
    await _ensure_can_send(db, user, spec)
    await _send_now(db, user, msg)
    await db.flush()
    await _audit(db, user, msg, "send")
    await db.refresh(msg)
    return _to_out(msg, user.display_name)


@router.delete(
    "/messages/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除草稿 / 取消預約",
)
async def delete_message(message_id: uuid.UUID, db: DbDep, user: EmailUser) -> None:
    msg = await _get_owned_message(db, message_id, user)
    if msg.status == EmailStatus.DRAFT:
        await db.delete(msg)
    elif msg.status == EmailStatus.SCHEDULED:
        msg.status = EmailStatus.CANCELLED
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="只有草稿或預約中的郵件可以刪除/取消"
        )
    await db.flush()


@router.get("/messages", response_model=list[EmailMessageOut], summary="郵件列表（草稿/已寄/紀錄）")
async def list_messages(
    db: DbDep,
    user: EmailUser,
    status_filter: str | None = Query(None, alias="status", description="依狀態過濾"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[EmailMessageOut]:
    codes = await get_user_permission_codes(db, user.id)
    can_view_all = (
        user.is_superuser
        or PermissionCode.EMAIL_VIEW_LOGS in codes
        or PermissionCode.ADMIN_ALL in codes
    )
    stmt = (
        select(EmailMessage)
        .options(selectinload(EmailMessage.sender))
        .order_by(EmailMessage.created_at.desc())
    )
    if not can_view_all:
        stmt = stmt.where(EmailMessage.sender_id == user.id)
    if status_filter:
        stmt = stmt.where(EmailMessage.status == status_filter)
    stmt = stmt.limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(m, m.sender.display_name if m.sender else None) for m in rows]


@router.get(
    "/messages/{message_id}", response_model=EmailMessageDetailOut, summary="郵件詳情"
)
async def get_message(
    message_id: uuid.UUID, db: DbDep, user: EmailUser
) -> EmailMessageDetailOut:
    stmt = (
        select(EmailMessage)
        .options(selectinload(EmailMessage.sender))
        .where(EmailMessage.id == message_id)
    )
    msg = (await db.execute(stmt)).scalar_one_or_none()
    if msg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="郵件不存在")
    codes = await get_user_permission_codes(db, user.id)
    can_view_all = (
        user.is_superuser
        or PermissionCode.EMAIL_VIEW_LOGS in codes
        or PermissionCode.ADMIN_ALL in codes
    )
    if msg.sender_id != user.id and not can_view_all:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無法檢視他人的郵件")
    return _to_detail(
        msg,
        msg.sender.display_name if msg.sender else None,
        can_view_emails=can_view_all,
    )
