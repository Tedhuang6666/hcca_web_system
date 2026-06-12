from __future__ import annotations

import pytest

from api.models.governance import Matter, PlanningDocumentAttachment
from api.models.org import Org
from api.models.user import User
from api.schemas.governance import (
    PlanningDocumentCreate,
    PlanningDocumentRevisionCreate,
    PlanningDocumentRevisionOut,
)
from api.services import governance as governance_svc
from api.services import governance_modules


@pytest.mark.asyncio
async def test_planning_revision_reuses_shared_attachment(db_session) -> None:
    actor = User(
        email="planner@example.edu.tw",
        display_name="企劃承辦人",
        is_active=True,
        is_verified=True,
    )
    matter = Matter(title="校慶企劃", created_by_id=actor.id)
    db_session.add_all([actor, matter])
    await db_session.flush()

    document = await governance_svc.create_planning_document(
        db_session,
        matter=matter,
        data=PlanningDocumentCreate(title="校慶執行企劃", content="第一版"),
        user=actor,
    )
    attachment = PlanningDocumentAttachment(
        document_id=document.id,
        filename="plan.pdf",
        storage_key="planning/plan.pdf",
        content_type="application/pdf",
        file_size=1024,
        uploaded_by_id=actor.id,
    )
    db_session.add(attachment)
    await db_session.flush()

    revision = await governance_svc.create_planning_revision(
        db_session,
        document=document,
        data=PlanningDocumentRevisionCreate(
            version_label="送審版",
            content="第二版",
            attachment_ids=[attachment.id],
            primary_attachment_id=attachment.id,
        ),
        user=actor,
    )
    loaded = await governance_svc.get_planning_document(db_session, document.id)

    assert revision.version_number == 2
    assert loaded is not None
    assert loaded.attachments[0].id == attachment.id
    assert loaded.revisions[-1].attachment_links[0].is_primary is True
    assert await governance_svc.attachment_is_referenced(db_session, attachment.id)
    assert PlanningDocumentRevisionOut.model_validate(revision).attachment_links[
        0
    ].attachment_id == (attachment.id)


@pytest.mark.asyncio
async def test_planning_revision_rejects_attachment_from_other_document(db_session) -> None:
    actor = User(
        email="planner2@example.edu.tw",
        display_name="第二承辦人",
        is_active=True,
        is_verified=True,
    )
    matter = Matter(title="跨企劃附件測試")
    db_session.add_all([actor, matter])
    await db_session.flush()
    first = await governance_svc.create_planning_document(
        db_session,
        matter=matter,
        data=PlanningDocumentCreate(title="企劃甲"),
        user=actor,
    )
    second = await governance_svc.create_planning_document(
        db_session,
        matter=matter,
        data=PlanningDocumentCreate(title="企劃乙"),
        user=actor,
    )
    attachment = PlanningDocumentAttachment(
        document_id=first.id,
        filename="wrong.pdf",
        storage_key="planning/wrong.pdf",
        content_type="application/pdf",
        file_size=128,
    )
    db_session.add(attachment)
    await db_session.flush()

    with pytest.raises(ValueError, match="不屬於此企劃書"):
        await governance_svc.create_planning_revision(
            db_session,
            document=second,
            data=PlanningDocumentRevisionCreate(
                version_label="錯誤版",
                content="不可引用",
                attachment_ids=[attachment.id],
            ),
            user=actor,
        )


@pytest.mark.asyncio
async def test_governance_resource_search_returns_linkable_shape(db_session) -> None:
    org = Org(name="學生議會", description="校園治理")
    db_session.add(org)
    await db_session.flush()

    rows = await governance_modules.search_resources(
        db_session,
        kind="org",
        query="議會",
        limit=10,
    )

    assert rows == [
        {
            "id": org.id,
            "kind": "org",
            "title": "學生議會",
            "summary": "校園治理",
            "status": None,
            "href": f"/orgs/{org.id}",
        }
    ]
