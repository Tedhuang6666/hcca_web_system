"""Document template service tests."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org
from api.models.user import User
from api.schemas.document import (
    DocumentTemplateCreate,
    DocumentTemplateDraftCreate,
    DocumentTemplateUpdate,
    RecipientCreate,
    SerialTemplateCreate,
)
from api.services import document as doc_svc


@pytest.mark.asyncio
async def test_document_template_crud_and_create_draft(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org = Org(name="秘書處", prefix="嶺秘")
    user = User(email="template@example.com", display_name="Template User", is_verified=True)
    db_session.add_all([org, user])
    await db_session.flush()

    template = await doc_svc.create_document_template(
        db_session,
        data=DocumentTemplateCreate(
            org_id=org.id,
            name="經費核銷函",
            subject="為辦理活動經費核銷事宜，請 鑒核。",
            doc_description="一、依據活動成果辦理核銷。",
            action_required="一、請核定核銷清冊。",
            handler_unit="秘書處",
            recipients=[
                RecipientCreate(recipient_type="main", name="學生代表大會", email=None),
            ],
        ),
        created_by=user.id,
    )
    assert template.version == 1
    assert template.recipients[0]["name"] == "學生代表大會"

    listed = await doc_svc.list_document_templates(db_session, org_id=org.id, keyword="核銷")
    assert [item.id for item in listed] == [template.id]

    await doc_svc.update_document_template(
        db_session,
        template,
        data=DocumentTemplateUpdate(description="常用核銷範本"),
        updated_by=user.id,
    )
    assert template.version == 2
    assert template.description == "常用核銷範本"

    serial_template = await doc_svc.create_serial_template(
        db_session,
        data=SerialTemplateCreate(org_id=org.id, category_char="生"),
        created_by=user.id,
    )

    async def fake_serial(_session: AsyncSession, _template: object) -> str:
        return "DOC-2026-000777"

    monkeypatch.setattr("api.services.document._lifecycle", "generate_serial_from_template", fake_serial)
    draft = await doc_svc.create_document_from_template(
        db_session,
        template=template,
        data=DocumentTemplateDraftCreate(
            title="活動經費核銷函",
            handler_name="王小明",
            serial_template_id=serial_template.id,
        ),
        created_by=user.id,
    )
    assert draft.serial_number == "DOC-2026-000777"
    assert draft.title == "活動經費核銷函"
    assert draft.subject == template.subject
    assert draft.handler_name == "王小明"
    assert draft.recipients[0].name == "學生代表大會"


@pytest.mark.asyncio
async def test_inactive_document_template_hidden_by_default(db_session: AsyncSession) -> None:
    org = Org(name="行政部", prefix="嶺行")
    user = User(email="inactive-template@example.com", display_name="Template User")
    db_session.add_all([org, user])
    await db_session.flush()

    template = await doc_svc.create_document_template(
        db_session,
        data=DocumentTemplateCreate(
            org_id=org.id,
            name="公告範本",
            category="announcement",
            subject="為公告校園自治事項，請 查照。",
        ),
        created_by=user.id,
    )
    await doc_svc.deactivate_document_template(db_session, template, updated_by=user.id)

    active = await doc_svc.list_document_templates(db_session, org_id=org.id)
    all_items = await doc_svc.list_document_templates(db_session, org_id=org.id, active_only=False)

    assert active == []
    assert [item.id for item in all_items] == [template.id]
