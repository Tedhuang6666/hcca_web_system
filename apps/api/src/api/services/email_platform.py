from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import math
import uuid
from datetime import UTC, datetime

import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.email.renderer import validate_required_variables, validate_variable_definitions
from api.models.email_message import (
    EmailAttachment,
    EmailCampaignRecipient,
    EmailEventType,
    EmailMessage,
    EmailRecipientEvent,
    EmailRecipientList,
    EmailRecipientListMember,
    EmailResourceVisibility,
    EmailSuppression,
    EmailTemplate,
    EmailTemplateVersion,
)
from api.models.user import User
from api.schemas.email_platform import (
    EmailPreflightInput,
    EmailPreflightOut,
    EmailRecipientListPayload,
    EmailRecipientListUpdate,
    EmailTemplatePayload,
    EmailTemplateUpdate,
)
from api.services.recipient import resolve_recipients, spec_to_resolve_kwargs
from api.services.storage import get_storage


def _normalize_email(value: str) -> str:
    return value.strip().lower()


def _validate_visibility(visibility: str, org_id: uuid.UUID | None) -> None:
    if visibility == EmailResourceVisibility.ORG and org_id is None:
        raise HTTPException(status_code=422, detail="組織共享資源必須指定 org_id")


async def list_templates(
    db: AsyncSession, user_id: uuid.UUID, org_ids: set[uuid.UUID]
) -> list[EmailTemplate]:
    stmt = (
        select(EmailTemplate)
        .where(
            EmailTemplate.is_active.is_(True),
            or_(
                EmailTemplate.owner_id == user_id,
                EmailTemplate.org_id.in_(org_ids) if org_ids else False,
            ),
        )
        .order_by(
            EmailTemplate.is_favorite.desc(),
            EmailTemplate.last_used_at.desc().nullslast(),
            EmailTemplate.updated_at.desc(),
        )
    )
    return list((await db.execute(stmt)).scalars().all())


async def create_template(
    db: AsyncSession, user_id: uuid.UUID, payload: EmailTemplatePayload
) -> EmailTemplate:
    _validate_visibility(payload.visibility, payload.org_id)
    definitions = validate_variable_definitions(payload.variable_definitions)
    row = EmailTemplate(
        owner_id=user_id,
        org_id=payload.org_id,
        visibility=payload.visibility,
        name=payload.name,
        description=payload.description,
        content=payload.content,
        variable_definitions=definitions,
        is_favorite=payload.is_favorite,
    )
    db.add(row)
    await db.flush()
    db.add(
        EmailTemplateVersion(
            template_id=row.id,
            version=1,
            content=row.content,
            variable_definitions=definitions,
            created_by_id=user_id,
        )
    )
    await db.flush()
    return row


async def update_template(
    db: AsyncSession,
    row: EmailTemplate,
    user_id: uuid.UUID,
    payload: EmailTemplateUpdate,
) -> EmailTemplate:
    values = payload.model_dump(exclude_unset=True)
    visibility = values.get("visibility", row.visibility)
    org_id = values.get("org_id", row.org_id)
    _validate_visibility(visibility, org_id)
    content_changed = "content" in values or "variable_definitions" in values
    if "variable_definitions" in values:
        values["variable_definitions"] = validate_variable_definitions(
            values["variable_definitions"]
        )
    for key, value in values.items():
        setattr(row, key, value)
    if content_changed:
        row.current_version += 1
        db.add(
            EmailTemplateVersion(
                template_id=row.id,
                version=row.current_version,
                content=row.content,
                variable_definitions=row.variable_definitions,
                created_by_id=user_id,
            )
        )
    await db.flush()
    return row


async def list_recipient_lists(
    db: AsyncSession, user_id: uuid.UUID, org_ids: set[uuid.UUID]
) -> list[EmailRecipientList]:
    stmt = (
        select(EmailRecipientList)
        .options(selectinload(EmailRecipientList.members))
        .where(
            EmailRecipientList.is_active.is_(True),
            or_(
                EmailRecipientList.owner_id == user_id,
                EmailRecipientList.org_id.in_(org_ids) if org_ids else False,
            ),
        )
        .order_by(EmailRecipientList.updated_at.desc())
    )
    return list((await db.execute(stmt)).scalars().unique().all())


async def _replace_list_members(
    db: AsyncSession, list_id: uuid.UUID, members: list
) -> None:
    await db.execute(
        delete(EmailRecipientListMember).where(EmailRecipientListMember.list_id == list_id)
    )
    seen: set[str] = set()
    for member in members:
        email = _normalize_email(str(member.email))
        if email in seen:
            continue
        seen.add(email)
        db.add(
            EmailRecipientListMember(
                list_id=list_id,
                user_id=member.user_id,
                email=email,
                name=member.name,
                variables=member.variables,
            )
        )


async def create_recipient_list(
    db: AsyncSession, user_id: uuid.UUID, payload: EmailRecipientListPayload
) -> EmailRecipientList:
    _validate_visibility(payload.visibility, payload.org_id)
    row = EmailRecipientList(
        owner_id=user_id,
        org_id=payload.org_id,
        visibility=payload.visibility,
        name=payload.name,
        description=payload.description,
        recipient_spec=payload.recipient_spec,
        variable_definitions=validate_variable_definitions(payload.variable_definitions),
    )
    db.add(row)
    await db.flush()
    await _replace_list_members(db, row.id, payload.members)
    await db.flush()
    return (
        await db.execute(
            select(EmailRecipientList)
            .options(selectinload(EmailRecipientList.members))
            .where(EmailRecipientList.id == row.id)
        )
    ).scalar_one()


async def update_recipient_list(
    db: AsyncSession, row: EmailRecipientList, payload: EmailRecipientListUpdate
) -> EmailRecipientList:
    values = payload.model_dump(exclude_unset=True)
    members = values.pop("members", None)
    visibility = values.get("visibility", row.visibility)
    org_id = values.get("org_id", row.org_id)
    _validate_visibility(visibility, org_id)
    if "variable_definitions" in values:
        values["variable_definitions"] = validate_variable_definitions(
            values["variable_definitions"]
        )
    for key, value in values.items():
        setattr(row, key, value)
    if members is not None:
        await _replace_list_members(db, row.id, payload.members or [])
    await db.flush()
    return (
        await db.execute(
            select(EmailRecipientList)
            .options(selectinload(EmailRecipientList.members))
            .where(EmailRecipientList.id == row.id)
        )
    ).scalar_one()


async def run_preflight(
    db: AsyncSession, sender: User, payload: EmailPreflightInput
) -> EmailPreflightOut:
    definitions = validate_variable_definitions(payload.variable_definitions)
    users, resolved_emails = await resolve_recipients(
        db, **spec_to_resolve_kwargs(payload.recipient_spec)
    )
    raw_emails = [*resolved_emails, *[str(row.email) for row in payload.recipient_variables]]
    normalized = [_normalize_email(value) for value in raw_emails if value.strip()]
    counts: dict[str, int] = {}
    for email in normalized:
        counts[email] = counts.get(email, 0) + 1
    duplicates = sorted(email for email, count in counts.items() if count > 1)
    unique = sorted(counts)
    suppressed = set(
        (
            await db.execute(
                select(EmailSuppression.email).where(
                    EmailSuppression.is_active.is_(True),
                    EmailSuppression.email.in_(unique) if unique else False,
                )
            )
        )
        .scalars()
        .all()
    )
    by_email = {_normalize_email(str(row.email)): row for row in payload.recipient_variables}
    missing_names: list[str] = []
    missing_variables: list[str] = []
    for user, email in zip(users, resolved_emails, strict=False):
        imported = by_email.get(_normalize_email(email))
        name = (imported.name if imported else None) or user.display_name
        variables = {**payload.default_variables, **(imported.variables if imported else {})}
        if not name:
            missing_names.append(email)
        try:
            validate_required_variables(definitions, variables, recipient_label=email)
        except ValueError as exc:
            missing_variables.append(str(exc))
    for row in payload.recipient_variables:
        if not row.name:
            missing_names.append(str(row.email))
        try:
            validate_required_variables(
                definitions,
                {**payload.default_variables, **row.variables},
                recipient_label=str(row.email),
            )
        except ValueError as exc:
            missing_variables.append(str(exc))
    attachments = (
        (
            await db.execute(
                select(EmailAttachment).where(
                    EmailAttachment.id.in_(payload.attachment_ids)
                    if payload.attachment_ids
                    else False
                )
            )
        )
        .scalars()
        .all()
    )
    total_bytes = sum(row.file_size for row in attachments)
    attachment_warnings = [
        f"{row.filename} 已撤銷或過期"
        for row in attachments
        if row.revoked_at or (row.expires_at and row.expires_at <= datetime.now(UTC))
    ]
    used = await db.scalar(
        select(func.coalesce(func.sum(EmailMessage.recipient_count), 0)).where(
            EmailMessage.sender_id == sender.id,
            EmailMessage.created_at >= datetime.now(UTC).replace(
                hour=0, minute=0, second=0, microsecond=0
            ),
        )
    )
    remaining = None if sender.is_superuser else max(
        0, settings.EMAIL_DAILY_QUOTA_PER_USER - int(used or 0)
    )
    unique_allowed = len(set(unique) - suppressed)
    return EmailPreflightOut(
        valid=not missing_variables and not attachment_warnings and unique_allowed > 0,
        resolved_count=len(normalized),
        unique_count=unique_allowed,
        duplicate_emails=duplicates,
        invalid_emails=[],
        suppressed_emails=sorted(suppressed),
        missing_names=sorted(set(missing_names)),
        missing_variables=missing_variables,
        attachment_total_bytes=total_bytes,
        attachment_warnings=attachment_warnings,
        quota_remaining=remaining,
        estimated_batches=math.ceil(unique_allowed / settings.EMAIL_SEND_BATCH_SIZE)
        if unique_allowed
        else 0,
    )


async def get_analytics(db: AsyncSession, message_id: uuid.UUID) -> dict:
    rows = (
        (
            await db.execute(
                select(EmailCampaignRecipient).where(
                    EmailCampaignRecipient.message_id == message_id
                )
            )
        )
        .scalars()
        .all()
    )
    total = len(rows)
    delivered = sum(bool(row.delivered_at or row.sent_at) for row in rows)
    bounced = sum(bool(row.bounced_at) for row in rows)
    complained = sum(bool(row.complained_at) for row in rows)
    opened = sum(bool(row.first_opened_at) for row in rows)
    clicked = sum(bool(row.first_clicked_at) for row in rows)
    link_rows = (
        await db.execute(
            select(EmailRecipientEvent.url, func.count())
            .join(EmailCampaignRecipient)
            .where(
                EmailCampaignRecipient.message_id == message_id,
                EmailRecipientEvent.event_type == EmailEventType.CLICKED,
                EmailRecipientEvent.url.is_not(None),
            )
            .group_by(EmailRecipientEvent.url)
            .order_by(func.count().desc())
            .limit(20)
        )
    ).all()
    denominator = delivered or total or 1
    return {
        "message_id": message_id,
        "recipients": total,
        "delivered": delivered,
        "bounced": bounced,
        "complained": complained,
        "opened": opened,
        "clicked": clicked,
        "delivery_rate": delivered / (total or 1),
        "bounce_rate": bounced / (total or 1),
        "open_rate_estimated": opened / denominator,
        "click_rate": clicked / denominator,
        "unopened_emails": [row.email for row in rows if not row.first_opened_at],
        "top_links": [{"url": url, "clicks": count} for url, count in link_rows],
    }


async def export_recipients(db: AsyncSession, message_id: uuid.UUID, fmt: str) -> tuple[bytes, str]:
    rows = (
        (
            await db.execute(
                select(EmailCampaignRecipient).where(
                    EmailCampaignRecipient.message_id == message_id
                )
            )
        )
        .scalars()
        .all()
    )
    data = [
        {
            "email": row.email,
            "name": row.name or "",
            "status": row.status,
            "attempt_count": row.attempt_count,
            "sent_at": row.sent_at,
            "delivered_at": row.delivered_at,
            "first_opened_at": row.first_opened_at,
            "first_clicked_at": row.first_clicked_at,
            "bounced_at": row.bounced_at,
            "complained_at": row.complained_at,
            "error_detail": row.error_detail or "",
        }
        for row in rows
    ]
    if fmt == "xlsx":
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            pd.DataFrame(data).to_excel(writer, index=False, sheet_name="寄送明細")
        return output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    output_text = io.StringIO()
    writer = csv.DictWriter(output_text, fieldnames=list(data[0].keys()) if data else ["email"])
    writer.writeheader()
    writer.writerows(data)
    return output_text.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8"


def verify_resend_signature(body: bytes, headers: dict[str, str]) -> None:
    secret = settings.RESEND_WEBHOOK_SECRET
    if not secret:
        raise HTTPException(status_code=503, detail="RESEND_WEBHOOK_SECRET 未設定")
    message_id = headers.get("svix-id", "")
    timestamp = headers.get("svix-timestamp", "")
    signatures = headers.get("svix-signature", "")
    try:
        secret_bytes = base64.b64decode(secret.removeprefix("whsec_"))
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Webhook secret 格式錯誤") from exc
    signed = f"{message_id}.{timestamp}.".encode() + body
    expected = base64.b64encode(hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()
    supplied = [item.split(",", 1)[-1] for item in signatures.split() if item.startswith("v1,")]
    if not any(hmac.compare_digest(expected, value) for value in supplied):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Webhook 簽章無效")


async def process_resend_event(db: AsyncSession, payload: dict) -> bool:
    event_id = str(payload.get("id") or "")
    event_type_raw = str(payload.get("type") or "")
    data = dict(payload.get("data") or {})
    provider_id = str(data.get("email_id") or data.get("id") or "")
    if not event_id or not provider_id:
        return False
    exists = await db.scalar(
        select(EmailRecipientEvent.id).where(
            EmailRecipientEvent.provider_event_id == event_id
        )
    )
    if exists:
        return False
    recipient = await db.scalar(
        select(EmailCampaignRecipient).where(
            EmailCampaignRecipient.provider_id == provider_id
        )
    )
    if recipient is None:
        return False
    mapping = {
        "email.delivered": EmailEventType.DELIVERED,
        "email.bounced": EmailEventType.BOUNCED,
        "email.complained": EmailEventType.COMPLAINED,
        "email.opened": EmailEventType.OPENED,
        "email.clicked": EmailEventType.CLICKED,
    }
    event_type = mapping.get(event_type_raw)
    if event_type is None:
        return False
    event_at = datetime.now(UTC)
    event = EmailRecipientEvent(
        recipient_id=recipient.id,
        provider_event_id=event_id,
        event_type=event_type,
        event_at=event_at,
        url=str(data.get("click", {}).get("link") or "") or None,
        payload=payload,
    )
    db.add(event)
    if event_type == EmailEventType.DELIVERED:
        recipient.delivered_at = event_at
    elif event_type == EmailEventType.OPENED:
        recipient.first_opened_at = recipient.first_opened_at or event_at
        recipient.last_opened_at = event_at
    elif event_type == EmailEventType.CLICKED:
        recipient.first_clicked_at = recipient.first_clicked_at or event_at
        recipient.last_clicked_at = event_at
    elif event_type in {EmailEventType.BOUNCED, EmailEventType.COMPLAINED}:
        if event_type == EmailEventType.BOUNCED:
            recipient.bounced_at = event_at
        else:
            recipient.complained_at = event_at
        email = _normalize_email(recipient.email)
        suppression = await db.scalar(
            select(EmailSuppression).where(EmailSuppression.email == email)
        )
        if suppression is None:
            db.add(
                EmailSuppression(
                    email=email,
                    reason="bounce" if event_type == EmailEventType.BOUNCED else "complaint",
                    source="resend",
                    detail=event_type_raw,
                    suppressed_at=event_at,
                )
            )
        else:
            suppression.is_active = True
            suppression.reason = (
                "bounce" if event_type == EmailEventType.BOUNCED else "complaint"
            )
            suppression.suppressed_at = event_at
    await db.flush()
    return True


async def attachment_download_url(attachment: EmailAttachment) -> str:
    if attachment.revoked_at:
        raise HTTPException(status_code=410, detail="附件已撤銷")
    if attachment.expires_at and attachment.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=410, detail="附件連結已過期")
    return await get_storage().get_url(
        attachment.storage_key,
        expires=settings.EMAIL_ATTACHMENT_LINK_EXPIRES_SECONDS,
        disposition="attachment",
        download_name=attachment.filename,
    )
