"""公文服務層（_template.py）內容範本 CRUD + 從範本建立草稿測試 — 真實 DB session。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import DocumentCategory, DocumentVisibility
from api.models.org import Org
from api.schemas.document import (
    DocumentTemplateCreate,
    DocumentTemplateDraftCreate,
    DocumentTemplateUpdate,
    RecipientCreate,
)
from api.services.document import (
    create_document_from_template,
    create_document_template,
    deactivate_document_template,
    get_document_template,
    list_document_templates,
    update_document_template,
)

pytestmark = pytest.mark.asyncio


async def _make_org(db_session: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db_session.add(org)
    await db_session.flush()
    return org


def _template_payload(org: Org, **overrides: object) -> DocumentTemplateCreate:
    defaults: dict = {
        "org_id": org.id,
        "name": "標準函文範本",
        "subject": "為標準範本測試事項，特此擬稿，請 鑒核。",
        "content": "範本內容",
    }
    defaults.update(overrides)
    return DocumentTemplateCreate(**defaults)


# ── create_document_template ─────────────────────────────────────────────────


async def test_create_document_template_success(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()

    template = await create_document_template(
        db_session, data=_template_payload(org), created_by=creator.id
    )

    assert template.name == "標準函文範本"
    assert template.version == 1
    assert template.is_active is True
    assert template.created_by == creator.id


async def test_create_document_template_stores_recipients_as_json(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()

    template = await create_document_template(
        db_session,
        data=_template_payload(
            org, recipients=[RecipientCreate(recipient_type="main", name="教育部")]
        ),
        created_by=creator.id,
    )

    assert template.recipients == [
        {
            "recipient_type": "main",
            "name": "教育部",
            "email": None,
            "target_user_id": None,
            "target_org_id": None,
            "delivery_method": "none",
        }
    ]


# ── get / list ────────────────────────────────────────────────────────────────


async def test_get_document_template_missing_returns_none(db_session: AsyncSession) -> None:
    assert await get_document_template(db_session, uuid.uuid4()) is None


async def test_list_document_templates_filters_by_org_and_category(
    db_session: AsyncSession, make_user
) -> None:
    org1 = await _make_org(db_session)
    org2 = await _make_org(db_session)
    creator = await make_user()
    letter = await create_document_template(
        db_session,
        data=_template_payload(org1, category=DocumentCategory.LETTER),
        created_by=creator.id,
    )
    await create_document_template(
        db_session,
        data=_template_payload(org2, category=DocumentCategory.LETTER),
        created_by=creator.id,
    )
    await create_document_template(
        db_session,
        data=_template_payload(org1, name="公告範本", category=DocumentCategory.ANNOUNCEMENT),
        created_by=creator.id,
    )

    results = await list_document_templates(
        db_session, org_id=org1.id, category=DocumentCategory.LETTER
    )

    assert {t.id for t in results} == {letter.id}


async def test_list_document_templates_excludes_inactive_by_default(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    active = await create_document_template(
        db_session, data=_template_payload(org), created_by=creator.id
    )
    inactive = await create_document_template(
        db_session, data=_template_payload(org, name="停用範本"), created_by=creator.id
    )
    await deactivate_document_template(db_session, inactive, updated_by=creator.id)

    results = await list_document_templates(db_session, org_id=org.id)

    assert {t.id for t in results} == {active.id}


async def test_list_document_templates_with_empty_org_ids_returns_empty(
    db_session: AsyncSession,
) -> None:
    results = await list_document_templates(db_session, org_ids=[])
    assert results == []


async def test_list_document_templates_keyword_filter(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    matched = await create_document_template(
        db_session, data=_template_payload(org, name="特殊關鍵字範本"), created_by=creator.id
    )
    await create_document_template(
        db_session, data=_template_payload(org, name="其他範本"), created_by=creator.id
    )

    results = await list_document_templates(db_session, org_id=org.id, keyword="特殊關鍵字")

    assert {t.id for t in results} == {matched.id}


# ── update_document_template ─────────────────────────────────────────────────


async def test_update_document_template_bumps_version(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    template = await create_document_template(
        db_session, data=_template_payload(org), created_by=creator.id
    )

    updated = await update_document_template(
        db_session,
        template,
        data=DocumentTemplateUpdate(name="更新後名稱"),
        updated_by=creator.id,
    )

    assert updated.name == "更新後名稱"
    assert updated.version == 2
    assert updated.updated_by == creator.id


async def test_update_document_template_replaces_recipients(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    template = await create_document_template(
        db_session,
        data=_template_payload(
            org, recipients=[RecipientCreate(recipient_type="main", name="舊收件人")]
        ),
        created_by=creator.id,
    )

    updated = await update_document_template(
        db_session,
        template,
        data=DocumentTemplateUpdate(
            recipients=[RecipientCreate(recipient_type="copy", name="新收件人")]
        ),
        updated_by=creator.id,
    )

    assert len(updated.recipients) == 1
    assert updated.recipients[0]["name"] == "新收件人"


async def test_update_document_template_invalid_body_raises(
    db_session: AsyncSession, make_user
) -> None:
    """更新後若違反範本內容規則（如清空必填主旨）應拋出驗證錯誤。"""
    org = await _make_org(db_session)
    creator = await make_user()
    template = await create_document_template(
        db_session, data=_template_payload(org), created_by=creator.id
    )

    with pytest.raises(ValueError, match="主旨"):
        await update_document_template(
            db_session,
            template,
            data=DocumentTemplateUpdate(subject=""),
            updated_by=creator.id,
        )


# ── deactivate_document_template ─────────────────────────────────────────────


async def test_deactivate_document_template_marks_inactive_and_bumps_version(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    template = await create_document_template(
        db_session, data=_template_payload(org), created_by=creator.id
    )

    result = await deactivate_document_template(db_session, template, updated_by=creator.id)

    assert result.is_active is False
    assert result.version == 2


# ── create_document_from_template ────────────────────────────────────────────


async def test_create_document_from_template_uses_template_fields(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    template = await create_document_template(
        db_session,
        data=_template_payload(
            org,
            subject="為範本套用測試事項，特此擬稿，請 鑒核。",
            visibility_level=DocumentVisibility.PUBLIC,
        ),
        created_by=creator.id,
    )

    doc = await create_document_from_template(
        db_session,
        template=template,
        data=DocumentTemplateDraftCreate(title="自訂標題"),
        created_by=creator.id,
    )

    assert doc.title == "自訂標題"
    assert doc.subject == "為範本套用測試事項，特此擬稿，請 鑒核。"
    assert doc.visibility_level == DocumentVisibility.PUBLIC
    assert doc.org_id == org.id


async def test_create_document_from_template_defaults_title_to_template_name(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    template = await create_document_template(
        db_session, data=_template_payload(org, name="預設標題範本"), created_by=creator.id
    )

    doc = await create_document_from_template(
        db_session,
        template=template,
        data=DocumentTemplateDraftCreate(),
        created_by=creator.id,
    )

    assert doc.title == "預設標題範本"
