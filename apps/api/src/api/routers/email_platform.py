from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.config import settings
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.models.email_message import (
    EmailAttachment,
    EmailAttachmentMode,
    EmailCampaignRecipient,
    EmailMessage,
    EmailRecipientList,
    EmailResourceVisibility,
    EmailTemplate,
    EmailTemplateVersion,
)
from api.models.user import User
from api.schemas.email_platform import (
    EmailAnalyticsOut,
    EmailAttachmentOut,
    EmailPreflightInput,
    EmailPreflightOut,
    EmailRecipientListOut,
    EmailRecipientListPayload,
    EmailRecipientListUpdate,
    EmailTemplateOut,
    EmailTemplatePayload,
    EmailTemplateUpdate,
    EmailTemplateVersionOut,
)
from api.services import email_platform as platform_svc
from api.services.permission import (
    get_user_org_ids,
    get_user_permission_codes,
    get_user_permission_codes_for_org,
)
from api.services.storage import get_storage

router = APIRouter(prefix="/email", tags=["電子郵件平台"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
EmailUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.EMAIL_SEND,
            PermissionCode.EMAIL_SEND_BULK,
            PermissionCode.EMAIL_VIEW_LOGS,
            PermissionCode.ADMIN_ALL,
        )
    ),
]


async def _org_ids(db: AsyncSession, user: User) -> set[uuid.UUID]:
    return set(await get_user_org_ids(db, user.id))


async def _can_manage_org(db: AsyncSession, user: User, org_id: uuid.UUID | None) -> bool:
    if user.is_superuser:
        return True
    if org_id is None:
        return False
    codes = await get_user_permission_codes_for_org(db, user.id, org_id)
    return (
        PermissionCode.EMAIL_TEMPLATE_MANAGE in codes
        or PermissionCode.ADMIN_ALL in codes
    )


async def _get_template(db: AsyncSession, template_id: uuid.UUID) -> EmailTemplate:
    row = await db.get(EmailTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="郵件範本不存在")
    return row


async def _check_resource_edit(
    db: AsyncSession, user: User, owner_id: uuid.UUID, org_id: uuid.UUID | None
) -> None:
    if owner_id == user.id or user.is_superuser:
        return
    if not await _can_manage_org(db, user, org_id):
        raise HTTPException(status_code=403, detail="無權修改此組織共享資源")


@router.get("/templates", response_model=list[EmailTemplateOut], summary="列出私人與組織共享範本")
async def list_templates(db: DbDep, user: EmailUser) -> list[EmailTemplateOut]:
    rows = await platform_svc.list_templates(db, user.id, await _org_ids(db, user))
    return [EmailTemplateOut.model_validate(row) for row in rows]


@router.post(
    "/templates",
    response_model=EmailTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立郵件範本",
)
async def create_template(
    body: EmailTemplatePayload, db: DbDep, user: EmailUser
) -> EmailTemplateOut:
    if body.visibility == EmailResourceVisibility.ORG and not await _can_manage_org(
        db, user, body.org_id
    ):
        raise HTTPException(status_code=403, detail="無權建立此組織的共享範本")
    row = await platform_svc.create_template(db, user.id, body)
    return EmailTemplateOut.model_validate(row)


@router.patch("/templates/{template_id}", response_model=EmailTemplateOut)
async def update_template(
    template_id: uuid.UUID,
    body: EmailTemplateUpdate,
    db: DbDep,
    user: EmailUser,
) -> EmailTemplateOut:
    row = await _get_template(db, template_id)
    await _check_resource_edit(db, user, row.owner_id, row.org_id)
    if body.visibility == EmailResourceVisibility.ORG and not await _can_manage_org(
        db, user, body.org_id or row.org_id
    ):
        raise HTTPException(status_code=403, detail="無權共享到此組織")
    row = await platform_svc.update_template(db, row, user.id, body)
    return EmailTemplateOut.model_validate(row)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(template_id: uuid.UUID, db: DbDep, user: EmailUser) -> None:
    row = await _get_template(db, template_id)
    await _check_resource_edit(db, user, row.owner_id, row.org_id)
    row.is_active = False
    await db.flush()


@router.get(
    "/templates/{template_id}/versions",
    response_model=list[EmailTemplateVersionOut],
)
async def list_template_versions(
    template_id: uuid.UUID, db: DbDep, user: EmailUser
) -> list[EmailTemplateVersionOut]:
    row = await _get_template(db, template_id)
    if row.owner_id != user.id and row.org_id not in await _org_ids(db, user):
        raise HTTPException(status_code=403, detail="無權檢視此範本")
    versions = (
        (
            await db.execute(
                select(EmailTemplateVersion)
                .where(EmailTemplateVersion.template_id == template_id)
                .order_by(EmailTemplateVersion.version.desc())
            )
        )
        .scalars()
        .all()
    )
    return [EmailTemplateVersionOut.model_validate(item) for item in versions]


@router.get("/recipient-lists", response_model=list[EmailRecipientListOut])
async def list_recipient_lists(db: DbDep, user: EmailUser) -> list[EmailRecipientListOut]:
    rows = await platform_svc.list_recipient_lists(db, user.id, await _org_ids(db, user))
    return [EmailRecipientListOut.model_validate(row) for row in rows]


@router.post(
    "/recipient-lists",
    response_model=EmailRecipientListOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_recipient_list(
    body: EmailRecipientListPayload, db: DbDep, user: EmailUser
) -> EmailRecipientListOut:
    if body.visibility == EmailResourceVisibility.ORG and not await _can_manage_org(
        db, user, body.org_id
    ):
        raise HTTPException(status_code=403, detail="無權建立此組織的共享名單")
    row = await platform_svc.create_recipient_list(db, user.id, body)
    return EmailRecipientListOut.model_validate(row)


@router.patch("/recipient-lists/{list_id}", response_model=EmailRecipientListOut)
async def update_recipient_list(
    list_id: uuid.UUID,
    body: EmailRecipientListUpdate,
    db: DbDep,
    user: EmailUser,
) -> EmailRecipientListOut:
    row = await db.scalar(
        select(EmailRecipientList)
        .options(selectinload(EmailRecipientList.members))
        .where(EmailRecipientList.id == list_id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="收件名單不存在")
    await _check_resource_edit(db, user, row.owner_id, row.org_id)
    row = await platform_svc.update_recipient_list(db, row, body)
    return EmailRecipientListOut.model_validate(row)


@router.delete("/recipient-lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recipient_list(list_id: uuid.UUID, db: DbDep, user: EmailUser) -> None:
    row = await db.get(EmailRecipientList, list_id)
    if row is None:
        raise HTTPException(status_code=404, detail="收件名單不存在")
    await _check_resource_edit(db, user, row.owner_id, row.org_id)
    row.is_active = False
    await db.flush()


@router.post(
    "/attachments",
    response_model=EmailAttachmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_attachment(
    db: DbDep,
    user: EmailUser,
    file: UploadFile = File(...),
    template_id: uuid.UUID | None = Query(None),
) -> EmailAttachmentOut:
    if template_id:
        template = await _get_template(db, template_id)
        await _check_resource_edit(db, user, template.owner_id, template.org_id)
    try:
        stored = await get_storage().save(file, prefix=f"email/attachments/{user.id}")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    mode = (
        EmailAttachmentMode.ATTACHMENT
        if stored.file_size <= settings.EMAIL_ATTACHMENT_INLINE_MAX_BYTES
        else EmailAttachmentMode.LINK
    )
    row = EmailAttachment(
        template_id=template_id,
        uploaded_by_id=user.id,
        storage_key=stored.storage_key,
        filename=stored.filename,
        content_type=stored.content_type,
        file_size=stored.file_size,
        delivery_mode=mode,
        expires_at=(
            datetime.now(UTC) + timedelta(seconds=settings.EMAIL_ATTACHMENT_LINK_EXPIRES_SECONDS)
            if mode == EmailAttachmentMode.LINK
            else None
        ),
    )
    db.add(row)
    await db.flush()
    return EmailAttachmentOut.model_validate(row)


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_attachment(
    attachment_id: uuid.UUID, db: DbDep, user: EmailUser
) -> None:
    row = await db.get(EmailAttachment, attachment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="附件不存在")
    if row.uploaded_by_id != user.id and not user.is_superuser:
        raise HTTPException(status_code=403, detail="無權撤銷此附件")
    row.revoked_at = datetime.now(UTC)
    await db.flush()


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: uuid.UUID, db: DbDep, user: EmailUser
) -> RedirectResponse:
    row = await db.get(EmailAttachment, attachment_id)
    if row is None:
        raise HTTPException(status_code=404, detail="附件不存在")
    url = await platform_svc.attachment_download_url(row)
    return RedirectResponse(url)


@router.post("/preflight", response_model=EmailPreflightOut)
async def preflight(
    body: EmailPreflightInput, db: DbDep, user: EmailUser
) -> EmailPreflightOut:
    return await platform_svc.run_preflight(db, user, body)


async def _check_message_view(db: AsyncSession, user: User, message_id: uuid.UUID) -> EmailMessage:
    row = await db.get(EmailMessage, message_id)
    if row is None:
        raise HTTPException(status_code=404, detail="郵件不存在")
    codes = await get_user_permission_codes(db, user.id)
    if (
        row.sender_id != user.id
        and not user.is_superuser
        and PermissionCode.EMAIL_VIEW_LOGS not in codes
        and PermissionCode.ADMIN_ALL not in codes
    ):
        raise HTTPException(status_code=403, detail="無權檢視此郵件")
    return row


@router.get("/messages/{message_id}/analytics", response_model=EmailAnalyticsOut)
async def message_analytics(
    message_id: uuid.UUID, db: DbDep, user: EmailUser
) -> EmailAnalyticsOut:
    await _check_message_view(db, user, message_id)
    return EmailAnalyticsOut(**await platform_svc.get_analytics(db, message_id))


@router.get("/messages/{message_id}/export")
async def export_message_recipients(
    message_id: uuid.UUID,
    db: DbDep,
    user: EmailUser,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
) -> StreamingResponse:
    await _check_message_view(db, user, message_id)
    content, media_type = await platform_svc.export_recipients(db, message_id, format)
    ext = "xlsx" if format == "xlsx" else "csv"
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="email-{message_id}.{ext}"'},
    )


@router.post("/messages/{message_id}/clone")
async def clone_message(
    message_id: uuid.UUID,
    db: DbDep,
    user: EmailUser,
    audience: str = Query("all", pattern="^(all|unopened|undelivered)$"),
) -> dict[str, str]:
    source = await _check_message_view(db, user, message_id)
    recipients = (
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
    if audience == "unopened":
        recipients = [row for row in recipients if row.first_opened_at is None]
    elif audience == "undelivered":
        recipients = [
            row for row in recipients if row.delivered_at is None and row.sent_at is None
        ]
    draft = EmailMessage(
        sender_id=user.id,
        org_id=source.org_id,
        template_id=source.template_id,
        subject=f"副本：{source.subject}",
        body=source.body,
        template=source.template,
        context=dict(source.context or {}),
        recipient_spec={"external_emails": [row.email for row in recipients]},
        variable_definitions=list(source.variable_definitions or []),
        default_variables=dict(source.default_variables or {}),
        recipient_variables=[
            {
                "user_id": str(row.user_id) if row.user_id else None,
                "email": row.email,
                "name": row.name,
                "variables": dict(row.variables or {}),
            }
            for row in recipients
        ],
        track_opens=source.track_opens,
        track_clicks=source.track_clicks,
        status="draft",
    )
    db.add(draft)
    await db.flush()
    return {"id": str(draft.id)}


@router.post("/resend/webhook", include_in_schema=False)
async def resend_webhook(request: Request, db: DbDep) -> dict[str, bool]:
    body = await request.body()
    platform_svc.verify_resend_signature(
        body, {key.lower(): value for key, value in request.headers.items()}
    )
    payload = await request.json()
    processed = await platform_svc.process_resend_event(db, payload)
    return {"processed": processed}
