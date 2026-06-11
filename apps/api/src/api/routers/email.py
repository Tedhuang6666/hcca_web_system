"""電子郵件路由 — 平台寄信頁（收件人選擇 / 預覽 / 草稿 / 預約 / 寄送 / 紀錄）。"""

from __future__ import annotations

import base64
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.clock import local_today
from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.email.renderer import (
    build_personalization_context,
    validate_required_variables,
    validate_variable_definitions,
)
from api.email.sender import enqueue_rendered, render_generic_message, render_generic_subject
from api.models.email_message import (
    EmailAttachment,
    EmailAttachmentMode,
    EmailCampaignRecipient,
    EmailMessage,
    EmailRecipientListMember,
    EmailRecipientStatus,
    EmailStatus,
    EmailSuppression,
    EmailTemplate,
)
from api.models.user import User
from api.services import audit as audit_svc
from api.services.permission import get_user_permission_codes
from api.services.recipient import resolve_recipients, spec_to_resolve_kwargs
from api.services.storage import get_storage

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

    user_ids: list[uuid.UUID] = Field(default_factory=list)
    position_ids: list[uuid.UUID] = Field(default_factory=list)
    org_ids: list[uuid.UUID] = Field(default_factory=list)
    external_emails: list[EmailStr] = Field(default_factory=list, max_length=500)
    include_all: bool = False
    include_school: bool = False


class CardRow(BaseModel):
    label: str = Field(min_length=1, max_length=50)
    value: str = Field(min_length=1, max_length=200)


class EmailVariableDefinition(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    label: str = Field(default="", max_length=80)
    required: bool = False
    default_value: str = Field(default="", max_length=500)


class EmailButton(BaseModel):
    """行動按鈕（一封信可放多顆，可自訂樣式）。"""

    label: str = Field(default="", max_length=40)
    url: str = Field(default="", max_length=500)
    style: Literal["primary", "secondary", "outline"] = "primary"


class EmailBlock(BaseModel):
    """自由內容區塊：文字段落、圖片或分隔線，依陣列順序排在內文之後。"""

    type: Literal["text", "image", "divider"] = "text"
    md: str = Field(default="", max_length=5000)
    url: str = Field(default="", max_length=500)
    alt: str = Field(default="", max_length=200)


class EmailRecipientVariableInput(BaseModel):
    user_id: uuid.UUID | None = None
    email: str | None = Field(default=None, max_length=255)
    name: str | None = Field(default=None, max_length=100)
    variables: dict[str, str] = Field(default_factory=dict)


class EmailComposePayload(BaseModel):
    """寄信內容（預覽 / 草稿 / 寄送共用）。"""

    subject: str = Field(min_length=1, max_length=255)
    heading: str = Field(default="", max_length=200)
    preview_text: str = Field(default="", max_length=200)
    body: str = ""  # 富文本 HTML（渲染時以 bleach 清洗）
    accent_color: str = Field(default="#111827", pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str = Field(default="#eef2f7", pattern=r"^#[0-9A-Fa-f]{6}$")
    content_background_color: str = Field(default="#ffffff", pattern=r"^#[0-9A-Fa-f]{6}$")
    body_line_height: float = Field(default=1.6, ge=1.2, le=2.5)
    paragraph_spacing: int = Field(default=18, ge=0, le=40)
    footer_text: str = Field(default="", max_length=500)
    show_system_footer: bool = True
    banner_image_url: str = Field(default="", max_length=500)
    banner_image_alt: str = Field(default="", max_length=200)
    card_rows: list[CardRow] = Field(default_factory=list)
    cta_label: str = Field(default="", max_length=40)
    cta_url: str = Field(default="", max_length=500)
    buttons: list[EmailButton] = Field(default_factory=list)
    blocks: list[EmailBlock] = Field(default_factory=list)
    recipients: RecipientSelector = Field(default_factory=RecipientSelector)
    variable_definitions: list[EmailVariableDefinition] = Field(default_factory=list)
    default_variables: dict[str, str] = Field(default_factory=dict)
    recipient_variables: list[EmailRecipientVariableInput] = Field(default_factory=list)
    preview_variables: dict[str, str] = Field(default_factory=dict)
    preview_recipient: EmailRecipientVariableInput | None = None
    org_id: uuid.UUID | None = None
    template_id: uuid.UUID | None = None
    recipient_list_id: uuid.UUID | None = None
    attachment_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)
    track_opens: bool = True
    track_clicks: bool = True
    idempotency_key: str | None = Field(default=None, max_length=100)


class EmailMessageCreate(EmailComposePayload):
    action: Literal["draft", "schedule", "send"] = "draft"
    scheduled_at: datetime | None = None


class EmailMessageUpdate(BaseModel):
    """草稿/預約編輯，所有欄位 Optional。"""

    subject: str | None = Field(default=None, max_length=255)
    heading: str | None = Field(default=None, max_length=200)
    preview_text: str | None = Field(default=None, max_length=200)
    body: str | None = None
    accent_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    content_background_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    body_line_height: float | None = Field(default=None, ge=1.2, le=2.5)
    paragraph_spacing: int | None = Field(default=None, ge=0, le=40)
    footer_text: str | None = Field(default=None, max_length=500)
    show_system_footer: bool | None = None
    banner_image_url: str | None = Field(default=None, max_length=500)
    banner_image_alt: str | None = Field(default=None, max_length=200)
    card_rows: list[CardRow] | None = None
    cta_label: str | None = Field(default=None, max_length=40)
    cta_url: str | None = Field(default=None, max_length=500)
    buttons: list[EmailButton] | None = None
    blocks: list[EmailBlock] | None = None
    recipients: RecipientSelector | None = None
    variable_definitions: list[EmailVariableDefinition] | None = None
    default_variables: dict[str, str] | None = None
    recipient_variables: list[EmailRecipientVariableInput] | None = None
    scheduled_at: datetime | None = None
    org_id: uuid.UUID | None = None
    template_id: uuid.UUID | None = None
    recipient_list_id: uuid.UUID | None = None
    attachment_ids: list[uuid.UUID] | None = Field(default=None, max_length=20)
    track_opens: bool | None = None
    track_clicks: bool | None = None


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
    org_id: uuid.UUID | None
    template_id: uuid.UUID | None
    track_opens: bool
    track_clicks: bool


class EmailMessageDetailOut(EmailMessageOut):
    heading: str
    preview_text: str
    accent_color: str
    background_color: str
    content_background_color: str
    body_line_height: float
    paragraph_spacing: int
    footer_text: str
    show_system_footer: bool
    body: str
    banner_image_url: str
    banner_image_alt: str
    card_rows: list[dict]
    cta_label: str
    cta_url: str
    buttons: list[dict]
    blocks: list[dict]
    recipient_spec: dict
    variable_definitions: list[dict]
    default_variables: dict
    recipient_variables: list[dict]
    resolved_emails: list[str]
    recipient_status_counts: dict[str, int]
    recent_errors: list[str]
    error_detail: str | None
    attachment_ids: list[uuid.UUID]


class EmailCampaignRecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    message_id: uuid.UUID
    user_id: uuid.UUID | None
    email: str
    name: str | None
    variables: dict
    status: str
    celery_task_id: str | None
    provider_id: str | None
    sent_at: datetime | None
    error_detail: str | None
    attempt_count: int
    next_retry_at: datetime | None
    delivered_at: datetime | None
    first_opened_at: datetime | None
    last_opened_at: datetime | None
    first_clicked_at: datetime | None
    last_clicked_at: datetime | None
    bounced_at: datetime | None
    complained_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TestSendOut(BaseModel):
    status: str
    sent_to: str


class SampleTestSendOut(BaseModel):
    status: str
    queued: int
    sent_to: list[str]


class EmailSampleTestPayload(EmailComposePayload):
    recipient_indexes: list[int] = Field(default_factory=list, max_length=10)
    test_emails: list[EmailStr] = Field(default_factory=list, max_length=10)


class UploadedImageOut(BaseModel):
    url: str
    filename: str
    content_type: str
    file_size: int


_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})


# ── 內部輔助 ──────────────────────────────────────────────────────────────────


@dataclass
class PersonalizedRecipient:
    user_id: uuid.UUID | None
    email: str
    name: str | None
    student_id: str | None
    variables: dict[str, str]


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
        "external_emails": _normalize_external_emails(sel.external_emails),
        "include_all": sel.include_all,
        "include_school": sel.include_school,
    }


def _is_bulk(sel: RecipientSelector) -> bool:
    return bool(sel.position_ids or sel.org_ids or sel.include_all or sel.include_school)


def _normalize_external_emails(values: list[str]) -> list[str]:
    emails: list[str] = []
    seen: set[str] = set()
    for value in values:
        email = str(value).strip().lower()
        if email and email not in seen:
            seen.add(email)
            emails.append(email)
    return emails


def _safe_url_or_empty(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https", "mailto"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="CTA 連結只允許 http、https 或 mailto",
        )
    return value


def _safe_image_url(value: str) -> str:
    """圖片網址：允許 http/https 或站內上傳的相對路徑（/uploads/...）。"""
    value = (value or "").strip()
    if not value:
        return ""
    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"}:
        return value
    if not parsed.scheme and value.startswith("/"):
        return value
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="圖片網址只允許 http、https 或站內上傳路徑",
    )


def _buttons_to_ctx(buttons: list[EmailButton]) -> list[dict]:
    return [
        {"label": b.label, "url": _safe_url_or_empty(b.url), "style": b.style}
        for b in buttons
        if b.url.strip()
    ]


def _blocks_to_ctx(blocks: list[EmailBlock]) -> list[dict]:
    out: list[dict] = []
    for blk in blocks:
        if blk.type == "image":
            url = _safe_image_url(blk.url)
            if url:
                out.append({"type": "image", "url": url, "alt": blk.alt})
        elif blk.type == "divider":
            out.append({"type": "divider"})
        elif blk.md.strip():
            out.append({"type": "text", "md": blk.md})
    return out


def _build_context(payload: EmailComposePayload) -> dict:
    """把寄信內容組成範本 context（標題 / 卡片 / 內文按鈕 / 自由區塊 / 舊版 CTA）。"""
    return {
        "heading": payload.heading,
        "preview_text": payload.preview_text,
        "accent_color": payload.accent_color,
        "background_color": payload.background_color,
        "content_background_color": payload.content_background_color,
        "body_line_height": payload.body_line_height,
        "paragraph_spacing": payload.paragraph_spacing,
        "footer_text": payload.footer_text,
        "show_system_footer": payload.show_system_footer,
        "banner_image_url": _safe_image_url(payload.banner_image_url),
        "banner_image_alt": payload.banner_image_alt,
        "card_rows": [r.model_dump() for r in payload.card_rows],
        "cta_url": _safe_url_or_empty(payload.cta_url),
        "cta_label": payload.cta_label,
        "buttons": _buttons_to_ctx(payload.buttons),
        "blocks": _blocks_to_ctx(payload.blocks),
    }


def _normalize_definitions(definitions: list[EmailVariableDefinition]) -> list[dict]:
    try:
        return validate_variable_definitions([d.model_dump() for d in definitions])
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def _merged_custom_variables(
    definitions: list[dict], defaults: dict[str, str], recipient_vars: dict[str, str]
) -> dict[str, str]:
    allowed = {str(item["key"]) for item in definitions}
    merged: dict[str, str] = {
        str(item["key"]): str(item.get("default_value") or "") for item in definitions
    }
    merged.update({k: str(v) for k, v in defaults.items() if k in allowed})
    merged.update({k: str(v) for k, v in recipient_vars.items() if k in allowed})
    return merged


def _make_personalization_context(row: PersonalizedRecipient) -> dict:
    return build_personalization_context(
        user_id=row.user_id,
        name=row.name,
        email=row.email,
        student_id=row.student_id,
        custom_variables=row.variables,
    )


async def _resolve_personalized_recipients(
    db: AsyncSession,
    msg: EmailMessage,
) -> list[PersonalizedRecipient]:
    users, emails = await resolve_recipients(db, **spec_to_resolve_kwargs(msg.recipient_spec or {}))
    definitions = list(msg.variable_definitions or [])
    defaults = {str(k): str(v) for k, v in (msg.default_variables or {}).items()}
    inputs = list(msg.recipient_variables or [])
    recipient_list_id = (msg.recipient_spec or {}).get("recipient_list_id")
    if recipient_list_id:
        list_rows = (
            (
                await db.execute(
                    select(EmailRecipientListMember).where(
                        EmailRecipientListMember.list_id == uuid.UUID(str(recipient_list_id))
                    )
                )
            )
            .scalars()
            .all()
        )
        inputs.extend(
            {
                "user_id": str(item.user_id) if item.user_id else None,
                "email": item.email,
                "name": item.name,
                "variables": dict(item.variables or {}),
            }
            for item in list_rows
        )
    by_user_id = {str(row.get("user_id")): row for row in inputs if row.get("user_id")}
    by_email = {
        str(row.get("email", "")).strip().lower(): row
        for row in inputs
        if str(row.get("email", "")).strip()
    }

    rows: list[PersonalizedRecipient] = []
    seen_emails: set[str] = set()
    for user_obj, email in zip(users, emails, strict=False):
        imported = by_user_id.get(str(user_obj.id)) or by_email.get(email.strip().lower()) or {}
        imported_name = str(imported.get("name") or "").strip()
        custom = _merged_custom_variables(
            definitions, defaults, dict(imported.get("variables") or {})
        )
        label = imported_name or user_obj.display_name or email
        try:
            validate_required_variables(definitions, custom, recipient_label=label)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        normalized_email = email.strip().lower()
        seen_emails.add(normalized_email)
        rows.append(
            PersonalizedRecipient(
                user_id=user_obj.id,
                email=email,
                name=imported_name or user_obj.display_name,
                student_id=user_obj.student_id,
                variables=custom,
            )
        )

    external_inputs: list[dict] = [
        {"email": email, "name": None, "variables": {}}
        for email in _normalize_external_emails(
            [str(x) for x in (msg.recipient_spec or {}).get("external_emails", [])]
        )
    ]
    external_inputs.extend(inputs)

    for imported in external_inputs:
        email = str(imported.get("email") or "").strip()
        if not email or email.lower() in seen_emails:
            continue
        custom = _merged_custom_variables(
            definitions, defaults, dict(imported.get("variables") or {})
        )
        label = str(imported.get("name") or email)
        try:
            validate_required_variables(definitions, custom, recipient_label=label)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc
        seen_emails.add(email.lower())
        rows.append(
            PersonalizedRecipient(
                user_id=None,
                email=email,
                name=str(imported.get("name") or "") or None,
                student_id=None,
                variables=custom,
            )
        )
    if rows:
        suppressed = set(
            (
                await db.execute(
                    select(EmailSuppression.email).where(
                        EmailSuppression.is_active.is_(True),
                        EmailSuppression.email.in_([row.email.lower() for row in rows]),
                    )
                )
            )
            .scalars()
            .all()
        )
        rows = [row for row in rows if row.email.lower() not in suppressed]
    return rows


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
    today = local_today()
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
    definitions = _normalize_definitions(payload.variable_definitions)
    msg.subject = payload.subject
    msg.body = payload.body
    msg.template = "generic"
    msg.context = _build_context(payload)
    msg.recipient_spec = _spec_from_selector(payload.recipients)
    if payload.recipient_list_id:
        msg.recipient_spec["recipient_list_id"] = str(payload.recipient_list_id)
    msg.org_id = payload.org_id
    msg.template_id = payload.template_id
    msg.track_opens = payload.track_opens
    msg.track_clicks = payload.track_clicks
    msg.idempotency_key = payload.idempotency_key
    msg.variable_definitions = definitions
    msg.default_variables = {
        k: str(v)
        for k, v in payload.default_variables.items()
        if k in {str(item["key"]) for item in definitions}
    }
    msg.recipient_variables = [
        {
            "user_id": str(row.user_id) if row.user_id else None,
            "email": row.email,
            "name": row.name,
            "variables": {
                k: str(v)
                for k, v in row.variables.items()
                if k in {str(item["key"]) for item in definitions}
            },
        }
        for row in payload.recipient_variables
    ]


async def _render_attachments(
    attachments: list[EmailAttachment],
) -> tuple[list[dict[str, str]], list[dict]]:
    resend_attachments: list[dict[str, str]] = []
    link_blocks: list[dict] = []
    storage = get_storage()
    for attachment in attachments:
        if attachment.revoked_at or (
            attachment.expires_at and attachment.expires_at <= datetime.now(UTC)
        ):
            continue
        if attachment.delivery_mode == EmailAttachmentMode.ATTACHMENT:
            path = storage.local_path(attachment.storage_key)
            if path and path.exists():
                resend_attachments.append(
                    {
                        "filename": attachment.filename,
                        "content": base64.b64encode(path.read_bytes()).decode(),
                    }
                )
                continue
        url = await storage.get_url(
            attachment.storage_key,
            expires=settings.EMAIL_ATTACHMENT_LINK_EXPIRES_SECONDS,
            disposition="attachment",
            download_name=attachment.filename,
        )
        link_blocks.append({"type": "text", "md": f"[下載附件：{attachment.filename}]({url})"})
    return resend_attachments, link_blocks


async def _render_requested_attachments(
    db: AsyncSession, user: User, attachment_ids: list[uuid.UUID]
) -> tuple[list[dict[str, str]], list[dict]]:
    if not attachment_ids:
        return [], []
    attachments = (
        (
            await db.execute(
                select(EmailAttachment).where(
                    EmailAttachment.id.in_(attachment_ids),
                    EmailAttachment.uploaded_by_id == user.id,
                    EmailAttachment.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    if len(attachments) != len(set(attachment_ids)):
        raise HTTPException(status_code=404, detail="部分附件不存在或無權使用")
    return await _render_attachments(list(attachments))


async def _send_now(db: AsyncSession, user: User, msg: EmailMessage) -> None:
    """解析收件人、落庫後逐封排入寄送佇列，並更新 msg 狀態。"""
    rows = await _resolve_personalized_recipients(db, msg)
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="解析後無有效收件人"
        )
    await _check_quota(db, user, len(rows))
    await db.execute(
        delete(EmailCampaignRecipient).where(EmailCampaignRecipient.message_id == msg.id)
    )
    await db.flush()
    recipient_models: list[EmailCampaignRecipient] = []
    for row in rows:
        recipient = EmailCampaignRecipient(
            message_id=msg.id,
            user_id=row.user_id,
            email=row.email,
            name=row.name,
            variables=row.variables,
        )
        db.add(recipient)
        recipient_models.append(recipient)
    await db.flush()
    msg.resolved_emails = [row.email for row in rows]
    msg.recipient_count = len(rows)
    msg.status = EmailStatus.QUEUED
    msg.scheduled_at = None
    msg.error_detail = None
    await db.flush()
    attachments = (
        (await db.execute(select(EmailAttachment).where(EmailAttachment.message_id == msg.id)))
        .scalars()
        .all()
    )
    resend_attachments, link_blocks = await _render_attachments(list(attachments))
    render_context = dict(msg.context or {})
    render_context["blocks"] = [*list(render_context.get("blocks", [])), *link_blocks]
    dispatches: list[tuple[PersonalizedRecipient, EmailCampaignRecipient, str, str]] = []
    for row, recipient in zip(rows, recipient_models, strict=True):
        personal = _make_personalization_context(row)
        subject = render_generic_subject(msg.subject, personal)
        html = render_generic_message(msg.subject, msg.body, render_context, personal)
        dispatches.append((row, recipient, subject, html))

    # Worker 可能在 API request 結束前立刻取件；先 commit，確保 task 查得到收件人紀錄，
    # 才能正確回寫 attempt_count 與寄送狀態。
    await db.commit()

    task_ids: list[str] = []
    enqueue_errors = 0
    for row, recipient, subject, html in dispatches:
        try:
            task_ids.extend(
                enqueue_rendered(
                    [row.email],
                    subject,
                    html,
                    str(msg.id),
                    str(recipient.id),
                    resend_attachments or None,
                )
            )
            recipient.celery_task_id = task_ids[-1] if task_ids else None
        except Exception as exc:  # noqa: BLE001
            enqueue_errors += 1
            recipient.status = EmailRecipientStatus.FAILED
            recipient.error_detail = f"無法排入寄送佇列：{str(exc)[:450]}"
    msg.celery_task_id = task_ids[0] if task_ids else None
    if not task_ids:
        msg.status = EmailStatus.FAILED
        msg.error_detail = f"全部收件人無法排入寄送佇列（{enqueue_errors} 人）"
    elif enqueue_errors:
        msg.error_detail = f"部分收件人無法排入寄送佇列（{enqueue_errors} 人）"
    await db.flush()


async def _requeue_unsent(db: AsyncSession, msg: EmailMessage) -> int:
    """重新把尚未成功（queued/failed）的收件人渲染後排入寄送佇列。

    用於信件「卡在寄送中」或部分失敗時的補寄，沿用既有收件人快照與個人化變數，
    不重新解析收件對象（避免改變已稽核的寄送名單）。回傳重新排入的封數。
    """
    rows = (
        (
            await db.execute(
                select(EmailCampaignRecipient).where(
                    EmailCampaignRecipient.message_id == msg.id,
                    EmailCampaignRecipient.status != EmailRecipientStatus.SENT,
                )
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return 0
    attachments = (
        (await db.execute(select(EmailAttachment).where(EmailAttachment.message_id == msg.id)))
        .scalars()
        .all()
    )
    resend_attachments, link_blocks = await _render_attachments(list(attachments))
    render_context = dict(msg.context or {})
    render_context["blocks"] = [*list(render_context.get("blocks", [])), *link_blocks]
    dispatches: list[tuple[EmailCampaignRecipient, str, str]] = []
    for recipient in rows:
        personal = build_personalization_context(
            user_id=recipient.user_id,
            name=recipient.name,
            email=recipient.email,
            student_id=None,
            custom_variables=dict(recipient.variables or {}),
        )
        subject = render_generic_subject(msg.subject, personal)
        html = render_generic_message(msg.subject, msg.body, render_context, personal)
        recipient.status = EmailRecipientStatus.QUEUED
        recipient.error_detail = None
        recipient.next_retry_at = None
        dispatches.append((recipient, subject, html))
    msg.status = EmailStatus.QUEUED
    msg.error_detail = None
    await db.commit()

    requeued = 0
    enqueue_errors = 0
    for recipient, subject, html in dispatches:
        try:
            task_ids = enqueue_rendered(
                [recipient.email],
                subject,
                html,
                str(msg.id),
                str(recipient.id),
                resend_attachments or None,
            )
            recipient.celery_task_id = task_ids[0] if task_ids else None
            requeued += len(task_ids)
        except Exception as exc:  # noqa: BLE001
            enqueue_errors += 1
            recipient.status = EmailRecipientStatus.FAILED
            recipient.error_detail = f"無法排入寄送佇列：{str(exc)[:450]}"
    if requeued == 0:
        msg.status = EmailStatus.FAILED
        msg.error_detail = f"全部收件人無法排入寄送佇列（{enqueue_errors} 人）"
    elif enqueue_errors:
        msg.error_detail = f"部分收件人無法排入寄送佇列（{enqueue_errors} 人）"
    await db.flush()
    return requeued


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
        org_id=msg.org_id,
        template_id=msg.template_id,
        track_opens=msg.track_opens,
        track_clicks=msg.track_clicks,
    )


def _to_detail(
    msg: EmailMessage,
    sender_name: str | None,
    *,
    can_view_emails: bool,
    recipient_status_counts: dict[str, int] | None = None,
    recent_errors: list[str] | None = None,
) -> EmailMessageDetailOut:
    ctx = msg.context or {}
    return EmailMessageDetailOut(
        **_to_out(msg, sender_name).model_dump(),
        heading=str(ctx.get("heading", "")),
        preview_text=str(ctx.get("preview_text", "")),
        accent_color=str(ctx.get("accent_color", "#111827")),
        background_color=str(ctx.get("background_color", "#eef2f7")),
        content_background_color=str(ctx.get("content_background_color", "#ffffff")),
        body_line_height=float(ctx.get("body_line_height", 1.6)),
        paragraph_spacing=int(ctx.get("paragraph_spacing", 18)),
        footer_text=str(ctx.get("footer_text", "")),
        show_system_footer=bool(ctx.get("show_system_footer", True)),
        body=msg.body,
        banner_image_url=str(ctx.get("banner_image_url", "")),
        banner_image_alt=str(ctx.get("banner_image_alt", "")),
        card_rows=list(ctx.get("card_rows", [])),
        cta_label=str(ctx.get("cta_label", "")),
        cta_url=str(ctx.get("cta_url", "")),
        buttons=list(ctx.get("buttons", [])),
        blocks=list(ctx.get("blocks", [])),
        recipient_spec=msg.recipient_spec or {},
        variable_definitions=list(msg.variable_definitions or []),
        default_variables=dict(msg.default_variables or {}),
        recipient_variables=list(msg.recipient_variables or []),
        resolved_emails=list(msg.resolved_emails or []) if can_view_emails else [],
        recipient_status_counts=recipient_status_counts or {},
        recent_errors=recent_errors or [],
        error_detail=msg.error_detail,
        attachment_ids=[item.id for item in msg.attachments],
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


async def _get_owned_message(db: AsyncSession, message_id: uuid.UUID, user: User) -> EmailMessage:
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
    external_emails = [
        email
        for email in _normalize_external_emails([str(x) for x in body.external_emails])
        if email not in {value.strip().lower() for value in emails}
    ]
    return RecipientPreviewOut(
        recipient_count=len(emails) + len(external_emails),
        sample_names=[u.display_name for u in users[:_SAMPLE_LIMIT]],
        truncated=(len(users) + len(external_emails)) > _SAMPLE_LIMIT,
    )


@router.post(
    "/images",
    response_model=UploadedImageOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳信件內嵌圖片，回傳可直接插入內容區塊的 URL",
)
async def upload_email_image(
    user: EmailUser,
    file: UploadFile = File(...),
) -> UploadedImageOut:
    if (file.content_type or "") not in _IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="僅支援 JPEG / PNG / GIF / WebP 圖片",
        )
    storage = get_storage()
    try:
        stored = await storage.save(file, prefix="email")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return UploadedImageOut(
        url=stored.url or f"/uploads/{stored.storage_key}",
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
    )


@router.post("/preview", response_model=EmailPreviewOut, summary="渲染品牌信件預覽 HTML")
async def preview_email(body: EmailComposePayload, user: EmailUser) -> EmailPreviewOut:
    definitions = _normalize_definitions(body.variable_definitions)
    preview_row = body.preview_recipient
    custom = _merged_custom_variables(
        definitions,
        body.default_variables,
        preview_row.variables if preview_row else body.preview_variables,
    )
    preview_name = str(preview_row.name or "").strip() if preview_row else ""
    preview_email_address = str(preview_row.email or "").strip() if preview_row else ""
    personal = build_personalization_context(
        user_id=preview_row.user_id if preview_row else user.id,
        name=preview_name or user.display_name,
        email=preview_email_address or user.email,
        student_id=user.student_id if not preview_row else None,
        custom_variables=custom,
    )
    html = render_generic_message(body.subject, body.body, _build_context(body), personal)
    return EmailPreviewOut(html=html)


@router.post("/test", response_model=TestSendOut, summary="測試寄送：渲染後只寄給自己（不計配額）")
async def test_send(body: EmailComposePayload, db: DbDep, user: EmailUser) -> TestSendOut:
    if not user.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="您的帳號沒有 Email"
        )
    definitions = _normalize_definitions(body.variable_definitions)
    custom = _merged_custom_variables(definitions, body.default_variables, body.preview_variables)
    try:
        validate_required_variables(definitions, custom, recipient_label=user.display_name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    personal = build_personalization_context(
        user_id=user.id,
        name=user.display_name,
        email=user.email,
        student_id=user.student_id,
        custom_variables=custom,
    )
    subject = render_generic_subject(body.subject, personal)
    resend_attachments, link_blocks = await _render_requested_attachments(
        db, user, body.attachment_ids
    )
    render_context = _build_context(body)
    render_context["blocks"] = [*list(render_context.get("blocks", [])), *link_blocks]
    html = render_generic_message(body.subject, body.body, render_context, personal)
    enqueue_rendered(
        [user.email],
        f"[測試] {subject}",
        html,
        attachments=resend_attachments or None,
    )
    return TestSendOut(status="queued", sent_to=user.email)


@router.post(
    "/test-sample",
    response_model=SampleTestSendOut,
    summary="抽樣測試寄送：以選定資料列渲染後寄至測試信箱",
)
async def test_send_sample(
    body: EmailSampleTestPayload, db: DbDep, user: EmailUser
) -> SampleTestSendOut:
    destinations = [str(value) for value in body.test_emails] or [user.email]
    if not destinations or not destinations[0]:
        raise HTTPException(status_code=422, detail="沒有可用的測試收件信箱")
    definitions = _normalize_definitions(body.variable_definitions)
    indexes = body.recipient_indexes or list(range(min(3, len(body.recipient_variables))))
    selected = [
        body.recipient_variables[index]
        for index in indexes
        if 0 <= index < len(body.recipient_variables)
    ]
    if not selected:
        selected = [
            EmailRecipientVariableInput(
                user_id=user.id,
                email=user.email,
                name=user.display_name,
                variables=body.preview_variables,
            )
        ]
    resend_attachments, link_blocks = await _render_requested_attachments(
        db, user, body.attachment_ids
    )
    render_context = _build_context(body)
    render_context["blocks"] = [*list(render_context.get("blocks", [])), *link_blocks]
    queued = 0
    for index, row in enumerate(selected):
        custom = _merged_custom_variables(definitions, body.default_variables, row.variables)
        try:
            validate_required_variables(
                definitions,
                custom,
                recipient_label=row.name or row.email or f"第 {index + 1} 列",
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        personal = build_personalization_context(
            user_id=row.user_id,
            name=row.name,
            email=row.email or user.email,
            student_id=None,
            custom_variables=custom,
        )
        subject = render_generic_subject(body.subject, personal)
        html = render_generic_message(body.subject, body.body, render_context, personal)
        for destination in destinations:
            enqueue_rendered(
                [destination],
                f"[抽樣 {index + 1}] {subject}",
                html,
                attachments=resend_attachments or None,
            )
            queued += 1
    return SampleTestSendOut(status="queued", queued=queued, sent_to=destinations)


@router.post(
    "/messages",
    response_model=EmailMessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立郵件（draft 草稿 / schedule 預約 / send 立即寄送）",
)
async def create_message(body: EmailMessageCreate, db: DbDep, user: EmailUser) -> EmailMessageOut:
    await _ensure_can_send(db, user, body.recipients)
    if body.idempotency_key:
        existing = await db.scalar(
            select(EmailMessage).where(EmailMessage.idempotency_key == body.idempotency_key)
        )
        if existing is not None:
            return _to_out(existing, user.display_name)
    msg = EmailMessage(sender_id=user.id)
    _apply_compose(msg, body)
    db.add(msg)
    await db.flush()
    if body.attachment_ids:
        await db.execute(
            EmailAttachment.__table__.update()
            .where(
                EmailAttachment.id.in_(body.attachment_ids),
                EmailAttachment.uploaded_by_id == user.id,
                EmailAttachment.message_id.is_(None),
            )
            .values(message_id=msg.id)
        )
        await db.flush()
        await db.refresh(msg, attribute_names=["attachments"])

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

    if msg.template_id:
        template = await db.get(EmailTemplate, msg.template_id)
        if template:
            template.last_used_at = datetime.now(UTC)
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
    for key in (
        "preview_text",
        "accent_color",
        "background_color",
        "content_background_color",
        "body_line_height",
        "paragraph_spacing",
        "footer_text",
        "show_system_footer",
    ):
        value = getattr(body, key)
        if value is not None:
            ctx[key] = value
    if body.banner_image_url is not None:
        ctx["banner_image_url"] = _safe_image_url(body.banner_image_url)
    if body.banner_image_alt is not None:
        ctx["banner_image_alt"] = body.banner_image_alt
    if body.card_rows is not None:
        ctx["card_rows"] = [r.model_dump() for r in body.card_rows]
    if body.cta_url is not None:
        ctx["cta_url"] = _safe_url_or_empty(body.cta_url)
    if body.cta_label is not None:
        ctx["cta_label"] = body.cta_label
    if body.buttons is not None:
        ctx["buttons"] = _buttons_to_ctx(body.buttons)
    if body.blocks is not None:
        ctx["blocks"] = _blocks_to_ctx(body.blocks)
    msg.context = ctx
    if body.recipients is not None:
        await _ensure_can_send(db, user, body.recipients)
        msg.recipient_spec = _spec_from_selector(body.recipients)
    if body.variable_definitions is not None:
        msg.variable_definitions = _normalize_definitions(body.variable_definitions)
    allowed_keys = {str(item["key"]) for item in msg.variable_definitions or []}
    if body.default_variables is not None:
        msg.default_variables = {
            k: str(v) for k, v in body.default_variables.items() if k in allowed_keys
        }
    if body.recipient_variables is not None:
        msg.recipient_variables = [
            {
                "user_id": str(row.user_id) if row.user_id else None,
                "email": row.email,
                "name": row.name,
                "variables": {k: str(v) for k, v in row.variables.items() if k in allowed_keys},
            }
            for row in body.recipient_variables
        ]
    if body.recipient_list_id is not None:
        msg.recipient_spec = {
            **(msg.recipient_spec or {}),
            "recipient_list_id": str(body.recipient_list_id),
        }
    if body.org_id is not None:
        msg.org_id = body.org_id
    if body.template_id is not None:
        msg.template_id = body.template_id
    if body.track_opens is not None:
        msg.track_opens = body.track_opens
    if body.track_clicks is not None:
        msg.track_clicks = body.track_clicks
    if body.attachment_ids is not None:
        await db.execute(
            EmailAttachment.__table__.update()
            .where(EmailAttachment.message_id == msg.id)
            .values(message_id=None)
        )
        if body.attachment_ids:
            await db.execute(
                EmailAttachment.__table__.update()
                .where(
                    EmailAttachment.id.in_(body.attachment_ids),
                    EmailAttachment.uploaded_by_id == user.id,
                )
                .values(message_id=msg.id)
            )
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
async def send_message(message_id: uuid.UUID, db: DbDep, user: EmailUser) -> EmailMessageOut:
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


@router.post(
    "/messages/{message_id}/resend",
    response_model=EmailMessageOut,
    summary="重新寄送卡住或失敗的收件人（不重新解析收件名單）",
)
async def resend_message(message_id: uuid.UUID, db: DbDep, user: EmailUser) -> EmailMessageOut:
    msg = await _get_owned_message(db, message_id, user)
    if msg.status in {EmailStatus.DRAFT, EmailStatus.SCHEDULED, EmailStatus.CANCELLED}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="草稿 / 預約 / 已取消的郵件請改用「送出」，無法重新寄送",
        )
    requeued = await _requeue_unsent(db, msg)
    if requeued == 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="沒有需要重新寄送的收件人（全部都已成功寄出）",
        )
    await db.flush()
    await _audit(db, user, msg, "resend")
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
    q: str | None = Query(None, max_length=100),
    sender_id: uuid.UUID | None = Query(None),
    org_id: uuid.UUID | None = Query(None),
    template_id: uuid.UUID | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    mine: bool = Query(False, description="僅顯示目前帳號建立的郵件"),
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
    if mine or not can_view_all:
        stmt = stmt.where(EmailMessage.sender_id == user.id)
    if status_filter:
        stmt = stmt.where(EmailMessage.status == status_filter)
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                EmailMessage.subject.ilike(pattern),
                EmailMessage.sender.has(User.display_name.ilike(pattern)),
                EmailMessage.sender.has(User.email.ilike(pattern)),
            )
        )
    if sender_id:
        stmt = stmt.where(EmailMessage.sender_id == sender_id)
    if org_id:
        stmt = stmt.where(EmailMessage.org_id == org_id)
    if template_id:
        stmt = stmt.where(EmailMessage.template_id == template_id)
    if date_from:
        stmt = stmt.where(EmailMessage.created_at >= _to_utc(date_from))
    if date_to:
        stmt = stmt.where(EmailMessage.created_at <= _to_utc(date_to))
    stmt = stmt.limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()
    return [_to_out(m, m.sender.display_name if m.sender else None) for m in rows]


@router.get("/drafts", response_model=list[EmailMessageOut], summary="目前帳號的永久郵件草稿")
async def list_my_drafts(db: DbDep, user: EmailUser) -> list[EmailMessageOut]:
    rows = (
        (
            await db.execute(
                select(EmailMessage)
                .options(selectinload(EmailMessage.sender))
                .where(
                    EmailMessage.sender_id == user.id,
                    EmailMessage.status == EmailStatus.DRAFT,
                )
                .order_by(EmailMessage.updated_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )
    return [_to_out(message, user.display_name) for message in rows]


@router.get("/messages/{message_id}", response_model=EmailMessageDetailOut, summary="郵件詳情")
async def get_message(message_id: uuid.UUID, db: DbDep, user: EmailUser) -> EmailMessageDetailOut:
    stmt = (
        select(EmailMessage)
        .options(selectinload(EmailMessage.sender), selectinload(EmailMessage.attachments))
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
    status_rows = (
        await db.execute(
            select(EmailCampaignRecipient.status, func.count())
            .where(EmailCampaignRecipient.message_id == message_id)
            .group_by(EmailCampaignRecipient.status)
        )
    ).all()
    recent_errors = (
        await db.execute(
            select(EmailCampaignRecipient.email, EmailCampaignRecipient.error_detail)
            .where(
                EmailCampaignRecipient.message_id == message_id,
                EmailCampaignRecipient.error_detail.is_not(None),
            )
            .order_by(EmailCampaignRecipient.updated_at.desc())
            .limit(5)
        )
    ).all()
    return _to_detail(
        msg,
        msg.sender.display_name if msg.sender else None,
        can_view_emails=can_view_all or msg.sender_id == user.id,
        recipient_status_counts={str(row[0]): int(row[1]) for row in status_rows},
        recent_errors=[f"{email}: {err}" for email, err in recent_errors if err],
    )


@router.get(
    "/messages/{message_id}/recipients",
    response_model=list[EmailCampaignRecipientOut],
    summary="郵件收件人個人化變數與寄送狀態",
)
async def list_message_recipients(
    message_id: uuid.UUID,
    db: DbDep,
    user: EmailUser,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[EmailCampaignRecipientOut]:
    msg = await db.get(EmailMessage, message_id)
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
    rows = (
        (
            await db.execute(
                select(EmailCampaignRecipient)
                .where(EmailCampaignRecipient.message_id == message_id)
                .order_by(EmailCampaignRecipient.created_at.asc())
                .limit(limit)
                .offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return [EmailCampaignRecipientOut.model_validate(row, from_attributes=True) for row in rows]


@router.get(
    "/messages/{message_id}/recipients/{recipient_id}/preview",
    response_model=EmailPreviewOut,
    summary="預覽特定收件人實際收到的個人化郵件",
)
async def preview_message_recipient(
    message_id: uuid.UUID,
    recipient_id: uuid.UUID,
    db: DbDep,
    user: EmailUser,
) -> EmailPreviewOut:
    msg = await db.get(EmailMessage, message_id)
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
    recipient = await db.get(EmailCampaignRecipient, recipient_id)
    if recipient is None or recipient.message_id != message_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="收件人紀錄不存在")
    personal = build_personalization_context(
        user_id=recipient.user_id,
        name=recipient.name,
        email=recipient.email,
        student_id=None,
        custom_variables=dict(recipient.variables or {}),
    )
    html = render_generic_message(msg.subject, msg.body, msg.context or {}, personal)
    return EmailPreviewOut(html=html)
