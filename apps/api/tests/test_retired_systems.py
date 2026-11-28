"""Retirement regressions run against real PostgreSQL fixtures."""

import hashlib
import uuid
from datetime import UTC, datetime

from api.main import app
from api.models.announcement import Announcement, AnnouncementAudience
from api.models.document import (
    Document,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
)
from api.models.governance import EntityRelation, Matter
from api.models.org import Org
from api.models.petition import PetitionCase, PetitionPublicStatus, PetitionStatus, PetitionType
from api.models.regulation import Regulation, RegulationCategory
from api.models.user import User
from api.services.context import (
    document_approval_context,
    petition_resolution_context,
    regulation_usage_context,
)


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


def test_unprotected_force_logout_route_is_retired():
    # 強制登出只走 /admin/users/{user_id}/sessions/revoke（含受保護帳號檢查）
    paths = app.openapi()["paths"]
    assert "/admin/system/revoke-user-tokens" not in paths
    assert "post" in paths["/admin/users/{user_id}/sessions/revoke"]


async def test_context_omits_retired_matter_destinations(db_session, member_user):
    org = Org(name="脈絡回歸組織")
    db_session.add(org)
    await db_session.flush()
    matter = Matter(title="脈絡回歸事項", matter_type="administration")
    petition_type = PetitionType(name="脈絡回歸類型", responsible_org_id=org.id)
    db_session.add_all([matter, petition_type])
    await db_session.flush()
    document = Document(
        serial_number=f"CTX-{uuid.uuid4().hex[:12]}",
        title="脈絡回歸公文",
        org_id=org.id,
        created_by=member_user.id,
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


async def test_context_links_only_visible_records(db_session, member_user):
    prefix = "ContextTitle"
    org = Org(name=f"脈絡可見性-{uuid.uuid4().hex[:6]}")
    other_user = User(
        email=f"context-{uuid.uuid4().hex[:6]}@school.edu",
        display_name="其他陳情人",
        is_active=True,
        is_verified=True,
    )
    db_session.add_all([org, other_user])
    await db_session.flush()
    petition_type = PetitionType(name="脈絡查詢類型", responsible_org_id=org.id)
    regulation = Regulation(
        title=f"{prefix}法規",
        category=RegulationCategory.PROCEDURE,
        org_id=org.id,
        created_by=member_user.id,
        content="測試條文",
    )
    db_session.add_all([petition_type, regulation])
    await db_session.flush()

    def make_case(suffix: int, title: str, **options) -> PetitionCase:
        return PetitionCase(
            case_number=f"{case_base + suffix:07d}",
            share_token_hash=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
            type_id=petition_type.id,
            title=title,
            content="測試脈絡",
            current_org_id=org.id,
            submitted_at=datetime.now(UTC),
            **options,
        )

    case_base = uuid.uuid4().int % 9_000_000
    anchor = make_case(0, f"{prefix}原案", submitter_id=member_user.id)
    secret = make_case(
        1,
        f"{prefix}機密陳情",
        submitter_id=other_user.id,
        is_confidential=True,
    )
    public = make_case(
        2,
        f"{prefix}公開陳情",
        submitter_id=other_user.id,
        status=PetitionStatus.CLOSED,
        public_status=PetitionPublicStatus.PUBLISHED,
        public_title=f"{prefix}對外標題",
    )
    masked_public = make_case(
        3,
        f"{prefix}內部標題",
        submitter_id=other_user.id,
        status=PetitionStatus.CLOSED,
        public_status=PetitionPublicStatus.PUBLISHED,
        public_title="另一個公開標題",
    )
    public_document = Document(
        serial_number=f"CTX-PUB-{uuid.uuid4().hex[:8]}",
        title=f"{prefix}公開公文",
        org_id=org.id,
        created_by=member_user.id,
        status=DocumentStatus.APPROVED,
        visibility_level=DocumentVisibility.PUBLICLY_OPEN,
        classification=DocumentClassification.NORMAL,
    )
    secret_document = Document(
        serial_number=f"CTX-SEC-{uuid.uuid4().hex[:8]}",
        title=f"{prefix}機密公文",
        org_id=org.id,
        created_by=member_user.id,
        status=DocumentStatus.APPROVED,
        visibility_level=DocumentVisibility.PUBLICLY_OPEN,
        classification=DocumentClassification.SECRET,
    )
    draft_document = Document(
        serial_number=f"CTX-DRF-{uuid.uuid4().hex[:8]}",
        title=f"{prefix}草稿公文",
        org_id=org.id,
        created_by=member_user.id,
        status=DocumentStatus.DRAFT,
        visibility_level=DocumentVisibility.PUBLICLY_OPEN,
    )
    public_announcement = Announcement(
        title=f"{prefix}公開公告",
        content={},
        author_id=member_user.id,
        is_published=True,
        audience_type=AnnouncementAudience.ALL.value,
    )
    draft_announcement = Announcement(
        title=f"{prefix}草稿公告",
        content={},
        author_id=member_user.id,
        is_published=False,
        audience_type=AnnouncementAudience.ALL.value,
    )
    restricted_announcement = Announcement(
        title=f"{prefix}限閱公告",
        content={},
        author_id=member_user.id,
        is_published=True,
        audience_type=AnnouncementAudience.MEMBERS.value,
    )
    db_session.add_all(
        [
            anchor,
            secret,
            public,
            masked_public,
            public_document,
            secret_document,
            draft_document,
            public_announcement,
            draft_announcement,
            restricted_announcement,
        ]
    )
    await db_session.flush()

    usage = await regulation_usage_context(db_session, regulation.id)
    assert [link.title for link in usage.related_documents] == [public_document.title]
    assert [link.title for link in usage.related_petitions] == [f"{prefix}對外標題"]
    assert [link.title for link in usage.related_announcements] == [public_announcement.title]

    resolution = await petition_resolution_context(db_session, anchor.id, viewer=member_user)
    assert [link.title for link in resolution.similar_petitions] == [f"{prefix}對外標題"]
