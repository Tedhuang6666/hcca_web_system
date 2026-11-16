"""Retirement regressions run against real PostgreSQL fixtures."""

import hashlib
import uuid
from datetime import UTC, datetime

from api.main import app
from api.models.activity import Activity
from api.models.document import Document
from api.models.governance import EntityRelation, Matter
from api.models.org import Org
from api.models.petition import PetitionCase, PetitionType
from api.models.regulation import Regulation, RegulationCategory
from api.services.context import document_approval_context, petition_resolution_context


def test_finance_and_regulation_surface_retains_current_operations():
    paths = app.openapi()["paths"]
    assert "/finance/budgets/{budget_id}/advance-receipt.docx" not in paths
    assert "get" in paths["/finance/budgets/{budget_id}/export.xlsx"]
    assert "post" in paths["/regulations/{reg_id}/publish"]
    assert "get" in paths["/regulations/{reg_id}/tree"]
    assert "post" in paths["/workflows/instances/{instance_id}/transition"]


async def test_retired_receipt_has_no_http_handler(client):
    response = await client.post(f"/finance/budgets/{uuid.uuid4()}/advance-receipt.docx", json={})
    assert response.status_code == 404


async def test_context_omits_retired_activity_and_matter_destinations(db_session, member_user):
    org = Org(name="脈絡回歸組織")
    db_session.add(org)
    await db_session.flush()
    activity = Activity(name="脈絡回歸活動", org_id=org.id)
    matter = Matter(title="脈絡回歸事項", matter_type="administration")
    petition_type = PetitionType(name="脈絡回歸類型", responsible_org_id=org.id)
    db_session.add_all([activity, matter, petition_type])
    await db_session.flush()
    document = Document(
        serial_number=f"CTX-{uuid.uuid4().hex[:12]}",
        title="脈絡回歸公文",
        org_id=org.id,
        created_by=member_user.id,
        activity_id=activity.id,
    )
    petition = PetitionCase(
        case_number=f"{uuid.uuid4().int % 10_000_000:07d}",
        share_token_hash=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
        type_id=petition_type.id,
        title="脈絡回歸活動",
        content="測試脈絡查詢",
        current_org_id=org.id,
        submitted_at=datetime.now(UTC),
    )
    regulation = Regulation(
        title="脈絡回歸活動相關規範",
        category=RegulationCategory.PROCEDURE,
        org_id=org.id,
        created_by=member_user.id,
        content="第一條 測試。",
    )
    db_session.add_all([document, petition, regulation])
    await db_session.flush()
    db_session.add(
        EntityRelation(
            matter_id=matter.id,
            source_type="matter",
            source_id=matter.id,
            target_type="document",
            target_id=document.id,
            relation="source",
            title="已退役的事項頁面",
            href=f"/matters/{matter.id}",
        )
    )
    await db_session.flush()

    document_context = await document_approval_context(db_session, document.id)
    assert "source_activity" not in document_context.model_dump()
    assert "related_items" not in document_context.model_dump()
    petition_context = await petition_resolution_context(db_session, petition.id)
    assert "related_activities" not in petition_context.model_dump()
    assert any(
        link.href == f"/regulations/{regulation.id}"
        for link in petition_context.related_regulations
    )
