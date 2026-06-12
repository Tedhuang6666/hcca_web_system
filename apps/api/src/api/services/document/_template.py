"""公文內容範本 CRUD + 從範本建立草稿"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.search import like_contains
from api.models.document import Document, DocumentCategory, DocumentTemplate
from api.schemas.document import (
    DocumentCreate,
    DocumentTemplateCreate,
    DocumentTemplateDraftCreate,
    DocumentTemplateUpdate,
    RecipientCreate,
)


def _recipients_to_json(recipients: list[RecipientCreate]) -> list[dict[str, str | None]]:
    return [item.model_dump(mode="json") for item in recipients]


def _recipients_from_json(items: list[dict] | None) -> list[RecipientCreate]:
    return [RecipientCreate.model_validate(item) for item in (items or [])]


def _validate_document_template(template: DocumentTemplate) -> None:
    DocumentTemplateCreate(
        org_id=template.org_id,
        name=template.name,
        description=template.description,
        issuer_full_name=template.issuer_full_name,
        urgency=template.urgency,
        classification=template.classification,
        declassification_condition=template.declassification_condition,
        category=template.category,
        subject=template.subject,
        doc_description=template.doc_description,
        action_required=template.action_required,
        content=template.content,
        meeting_purpose=template.meeting_purpose,
        meeting_location=template.meeting_location,
        meeting_chairperson=template.meeting_chairperson,
        handler_unit=template.handler_unit,
        file_number=template.file_number,
        retention_period=template.retention_period,
        visibility_level=template.visibility_level,
        recipients=_recipients_from_json(template.recipients),
    )


async def create_document_template(
    session: AsyncSession,
    *,
    data: DocumentTemplateCreate,
    created_by: uuid.UUID,
) -> DocumentTemplate:
    template = DocumentTemplate(
        org_id=data.org_id,
        name=data.name,
        description=data.description,
        issuer_full_name=data.issuer_full_name,
        urgency=data.urgency,
        classification=data.classification,
        declassification_condition=data.declassification_condition,
        category=data.category,
        subject=data.subject,
        doc_description=data.doc_description,
        action_required=data.action_required,
        content=data.content,
        meeting_purpose=data.meeting_purpose,
        meeting_location=data.meeting_location,
        meeting_chairperson=data.meeting_chairperson,
        handler_unit=data.handler_unit,
        file_number=data.file_number,
        retention_period=data.retention_period,
        visibility_level=data.visibility_level,
        recipients=_recipients_to_json(data.recipients),
        created_by=created_by,
        updated_by=created_by,
    )
    session.add(template)
    await session.flush()
    return template


async def get_document_template(
    session: AsyncSession,
    template_id: uuid.UUID,
) -> DocumentTemplate | None:
    result = await session.execute(
        select(DocumentTemplate).where(DocumentTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def list_document_templates(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    org_ids: list[uuid.UUID] | None = None,
    category: DocumentCategory | None = None,
    active_only: bool = True,
    keyword: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[DocumentTemplate]:
    from sqlalchemy import or_

    q = select(DocumentTemplate)
    if org_id:
        q = q.where(DocumentTemplate.org_id == org_id)
    elif org_ids is not None:
        if not org_ids:
            return []
        q = q.where(DocumentTemplate.org_id.in_(org_ids))
    if category:
        q = q.where(DocumentTemplate.category == category)
    if active_only:
        q = q.where(DocumentTemplate.is_active.is_(True))
    if keyword:
        pattern = like_contains(keyword)
        q = q.where(
            or_(
                DocumentTemplate.name.ilike(pattern),
                DocumentTemplate.description.ilike(pattern),
                DocumentTemplate.subject.ilike(pattern),
                DocumentTemplate.doc_description.ilike(pattern),
            )
        )
    q = q.order_by(DocumentTemplate.updated_at.desc()).limit(limit).offset(offset)
    result = await session.execute(q)
    return list(result.scalars().all())


async def update_document_template(
    session: AsyncSession,
    template: DocumentTemplate,
    *,
    data: DocumentTemplateUpdate,
    updated_by: uuid.UUID,
) -> DocumentTemplate:
    recipients = data.recipients if "recipients" in data.model_fields_set else None
    updates = data.model_dump(exclude_unset=True, exclude={"recipients"})
    for field, value in updates.items():
        setattr(template, field, value)
    if recipients is not None:
        template.recipients = _recipients_to_json(recipients)
    _validate_document_template(template)
    template.updated_by = updated_by
    template.version += 1
    await session.flush()
    return template


async def deactivate_document_template(
    session: AsyncSession,
    template: DocumentTemplate,
    *,
    updated_by: uuid.UUID,
) -> DocumentTemplate:
    template.is_active = False
    template.updated_by = updated_by
    template.version += 1
    await session.flush()
    return template


async def create_document_from_template(
    session: AsyncSession,
    *,
    template: DocumentTemplate,
    data: DocumentTemplateDraftCreate,
    created_by: uuid.UUID,
) -> Document:
    from api.services.document._lifecycle import create_document

    title = data.title or template.name
    payload = DocumentCreate(
        title=title,
        org_id=template.org_id,
        serial_template_id=data.serial_template_id,
        issuer_full_name=template.issuer_full_name,
        urgency=template.urgency,
        classification=template.classification,
        declassification_condition=template.declassification_condition,
        category=template.category,
        subject=template.subject,
        doc_description=template.doc_description,
        action_required=template.action_required,
        content=template.content,
        meeting_purpose=template.meeting_purpose,
        meeting_time=data.meeting_time,
        meeting_location=template.meeting_location,
        meeting_chairperson=template.meeting_chairperson,
        handler_name=data.handler_name,
        handler_unit=template.handler_unit,
        handler_email=data.handler_email,
        file_number=template.file_number,
        retention_period=template.retention_period,
        due_date=data.due_date,
        visibility_level=template.visibility_level,
        recipients=data.recipients or _recipients_from_json(template.recipients),
    )
    return await create_document(session, data=payload, created_by=created_by)
