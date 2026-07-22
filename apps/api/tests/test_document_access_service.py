"""公文服務層（_access.py）可見性 / 存取控制測試 — 真實 DB session。

涵蓋：get_document / get_document_by_serial、is_sensitive_document /
can_anonymous_access_document、user_has_full_document_access 各種身份判斷
（建立者／審核人／代理人／副本收件者／組織成員）、check_document_access、
build_document_list_items 密件遮蔽、list_documents 各種篩選與可見度過濾。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentClassification,
    DocumentRecipient,
    DocumentStatus,
    DocumentVisibility,
    RecipientType,
)
from api.models.org import Org, Position, UserPosition
from api.models.school_class import ClassManualMember, SchoolClass
from api.models.user import User
from api.services.document import (
    build_document_list_items,
    can_anonymous_access_document,
    check_document_access,
    get_approval_delegation,
    get_document,
    get_document_by_serial,
    is_sensitive_document,
    list_documents,
    user_has_full_document_access,
)

pytestmark = pytest.mark.asyncio


async def _make_org(db_session: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db_session.add(org)
    await db_session.flush()
    return org


async def _grant_position(
    db_session: AsyncSession, user: User, org: Org, *, start_date=None, end_date=None
) -> Position:
    position = Position(org_id=org.id, name=f"職位-{uuid.uuid4().hex[:6]}")
    db_session.add(position)
    await db_session.flush()
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=start_date or (local_today() - timedelta(days=30)),
            end_date=end_date,
        )
    )
    await db_session.flush()
    return position


def _make_doc(org: Org, creator: User, **overrides: object) -> Document:
    defaults: dict = {
        "serial_number": f"DOC-{uuid.uuid4().hex[:10]}",
        "title": "測試公文",
        "org_id": org.id,
        "created_by": creator.id,
        "status": DocumentStatus.DRAFT,
        "subject": "為測試公文存取控制，請 鑒核。",
        "created_at": datetime.now(UTC),
    }
    defaults.update(overrides)
    doc = Document(**defaults)
    return doc


# ── get_document / get_document_by_serial ───────────────────────────────────


async def test_get_document_returns_none_for_missing_id(db_session: AsyncSession) -> None:
    assert await get_document(db_session, uuid.uuid4()) is None


async def test_get_document_by_serial_finds_existing(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator, serial_number="DOC-SERIAL-LOOKUP")
    db_session.add(doc)
    await db_session.flush()

    found = await get_document_by_serial(db_session, "DOC-SERIAL-LOOKUP")
    assert found is not None
    assert found.id == doc.id


async def test_get_document_by_serial_missing_returns_none(db_session: AsyncSession) -> None:
    assert await get_document_by_serial(db_session, "DOC-NOT-EXIST") is None


async def test_get_approval_delegation_missing_returns_none(db_session: AsyncSession) -> None:
    assert await get_approval_delegation(db_session, uuid.uuid4()) is None


# ── is_sensitive_document / can_anonymous_access_document ───────────────────


@pytest.mark.parametrize(
    "classification,expected",
    [
        (DocumentClassification.NORMAL, False),
        (DocumentClassification.CONFIDENTIAL, True),
        (DocumentClassification.SECRET, True),
    ],
)
async def test_is_sensitive_document(
    db_session: AsyncSession, make_user, classification, expected
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator, classification=classification)
    assert is_sensitive_document(doc) is expected


async def test_can_anonymous_access_publicly_open_normal_doc(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN)
    assert can_anonymous_access_document(doc) is True


async def test_can_anonymous_access_denied_for_sensitive_public_doc(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(
        org,
        creator,
        visibility_level=DocumentVisibility.PUBLICLY_OPEN,
        classification=DocumentClassification.SECRET,
    )
    assert can_anonymous_access_document(doc) is False


async def test_can_anonymous_access_denied_for_non_open_visibility(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLIC)
    assert can_anonymous_access_document(doc) is False


# ── user_has_full_document_access ───────────────────────────────────────────


async def test_full_access_granted_to_creator(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()

    assert await user_has_full_document_access(db_session, doc, creator.id) is True


async def test_full_access_granted_to_approver(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    doc = _make_doc(org, creator, status=DocumentStatus.PENDING, current_step=1)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=approver.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
        )
    )
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, approver.id) is True


async def test_full_access_granted_to_manual_delegate(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    delegate = await make_user()
    doc = _make_doc(org, creator, status=DocumentStatus.PENDING, current_step=1)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=approver.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
            delegate_id=delegate.id,
            delegate_source=DelegateSource.MANUAL,
        )
    )
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, delegate.id) is True


async def test_full_access_denied_to_expired_assignment_delegate(
    db_session: AsyncSession, make_user
) -> None:
    """指派代理（ASSIGNMENT）已過期時，代理人不應再有完整存取權。"""
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    delegate = await make_user()
    doc = _make_doc(org, creator, status=DocumentStatus.PENDING, current_step=1)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=doc.id,
            approver_id=approver.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
            delegate_id=delegate.id,
            delegate_source=DelegateSource.ASSIGNMENT,
        )
    )
    # 建立一筆已過期的請假代理授權（end_at 已過）
    db_session.add(
        DocumentApprovalDelegation(
            org_id=org.id,
            principal_user_id=approver.id,
            delegate_user_id=delegate.id,
            start_at=datetime.now(UTC) - timedelta(days=10),
            end_at=datetime.now(UTC) - timedelta(days=1),
            is_active=True,
            created_by=approver.id,
        )
    )
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, delegate.id) is False


async def test_full_access_granted_to_recipient_matching_email(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    viewer = await make_user(email="viewer-recipient@school.edu")
    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentRecipient(
            document_id=doc.id,
            recipient_type=RecipientType.COPY,
            name="收件人",
            email="viewer-recipient@school.edu",
        )
    )
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, viewer.id) is True


async def test_full_access_granted_to_active_org_member(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    member = await make_user()
    await _grant_position(db_session, member, org)
    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, member.id) is True


async def test_full_access_granted_to_active_class_recipient(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    member = await make_user()
    school_class = SchoolClass(
        academic_year=115,
        class_code="401",
        grade=4,
        created_by=creator.id,
    )
    db_session.add(school_class)
    await db_session.flush()
    db_session.add(ClassManualMember(class_id=school_class.id, user_id=member.id))
    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    db_session.add(
        DocumentRecipient(
            document_id=doc.id,
            recipient_type=RecipientType.MAIN,
            name="115 學年度 401 班",
            target_class_id=school_class.id,
        )
    )
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, member.id) is True


async def test_full_access_denied_to_unrelated_stranger(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    stranger = await make_user()
    doc = _make_doc(org, creator)
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await user_has_full_document_access(db_session, doc, stranger.id) is False


# ── check_document_access ───────────────────────────────────────────────────


async def test_check_document_access_allows_public_visibility_for_non_member(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    viewer = await make_user()
    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLIC)
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await check_document_access(db_session, doc, viewer.id) is True


async def test_check_document_access_denies_org_only_for_non_member(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    viewer = await make_user()
    doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await check_document_access(db_session, doc, viewer.id) is False


async def test_check_document_access_denies_sensitive_public_for_non_full_access(
    db_session: AsyncSession, make_user
) -> None:
    """機密公文即使 visibility=public，非完整存取者仍不可看。"""
    org = await _make_org(db_session)
    creator = await make_user()
    viewer = await make_user()
    doc = _make_doc(
        org,
        creator,
        visibility_level=DocumentVisibility.PUBLIC,
        classification=DocumentClassification.SECRET,
    )
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    assert await check_document_access(db_session, doc, viewer.id) is False


# ── build_document_list_items ───────────────────────────────────────────────


async def test_build_document_list_items_redacts_sensitive_for_outsider(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    viewer = await make_user()
    doc = _make_doc(
        org,
        creator,
        classification=DocumentClassification.SECRET,
        title="機密標題",
        subject="機密主旨",
    )
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    [item] = await build_document_list_items(db_session, [doc], viewer_id=viewer.id)

    assert item.is_redacted is True
    assert item.title == "(此公文為密件)"
    assert item.subject is None


async def test_build_document_list_items_reveals_for_creator(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(
        org,
        creator,
        classification=DocumentClassification.CONFIDENTIAL,
        title="機密標題",
        subject="機密主旨",
    )
    db_session.add(doc)
    await db_session.flush()
    await db_session.refresh(doc, attribute_names=["approvals"])

    [item] = await build_document_list_items(db_session, [doc], viewer_id=creator.id)

    assert item.is_redacted is False
    assert item.title == "機密標題"


# ── list_documents ───────────────────────────────────────────────────────────


async def test_list_documents_filters_by_org_and_status(
    db_session: AsyncSession, make_user
) -> None:
    org1 = await _make_org(db_session)
    org2 = await _make_org(db_session)
    creator = await make_user()
    doc1 = _make_doc(org1, creator, status=DocumentStatus.DRAFT)
    doc2 = _make_doc(org2, creator, status=DocumentStatus.DRAFT)
    doc3 = _make_doc(org1, creator, status=DocumentStatus.APPROVED)
    db_session.add_all([doc1, doc2, doc3])
    await db_session.flush()

    results = await list_documents(db_session, org_id=org1.id, status=DocumentStatus.DRAFT)

    assert {d.id for d in results} == {doc1.id}


async def test_list_documents_public_only_excludes_non_open_docs(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    open_doc = _make_doc(
        org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN, title="公開公文"
    )
    private_doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    db_session.add_all([open_doc, private_doc])
    await db_session.flush()

    results = await list_documents(db_session, public_only=True)

    result_ids = {d.id for d in results}
    assert open_doc.id in result_ids
    assert private_doc.id not in result_ids


async def test_list_documents_viewer_visibility_hides_org_only_for_non_member(
    db_session: AsyncSession, make_user
) -> None:
    """org_only 公文不應出現在非該組織成員的可見清單中。"""
    org = await _make_org(db_session)
    creator = await make_user()
    viewer = await make_user()
    org_only_doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    public_doc = _make_doc(org, creator, visibility_level=DocumentVisibility.PUBLIC)
    db_session.add_all([org_only_doc, public_doc])
    await db_session.flush()

    results = await list_documents(db_session, viewer_id=viewer.id)

    result_ids = {d.id for d in results}
    assert public_doc.id in result_ids
    assert org_only_doc.id not in result_ids


async def test_list_documents_viewer_visibility_shows_org_only_for_member(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    member = await make_user()
    await _grant_position(db_session, member, org)
    org_only_doc = _make_doc(org, creator, visibility_level=DocumentVisibility.ORG_ONLY)
    db_session.add(org_only_doc)
    await db_session.flush()

    results = await list_documents(db_session, viewer_id=member.id)

    assert org_only_doc.id in {d.id for d in results}


async def test_list_documents_keyword_matches_subject(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator, subject="為特殊關鍵字搜尋測試，請 鑒核。")
    other = _make_doc(org, creator, subject="為完全不相關內容，請 鑒核。")
    db_session.add_all([doc, other])
    await db_session.flush()

    results = await list_documents(db_session, keyword="特殊關鍵字")

    assert {d.id for d in results} == {doc.id}


async def test_list_documents_serial_prefix_filter(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    matching = _make_doc(org, creator, serial_number="嶺代生字第1150000001號")
    non_matching = _make_doc(org, creator, serial_number="嶺學生字第1150000002號")
    db_session.add_all([matching, non_matching])
    await db_session.flush()

    results = await list_documents(db_session, serial_prefix="嶺代")

    assert {d.id for d in results} == {matching.id}


async def test_list_documents_date_range_filter(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    recent = _make_doc(org, creator, created_at=datetime.now(UTC))
    old = _make_doc(org, creator, created_at=datetime.now(UTC) - timedelta(days=100))
    db_session.add_all([recent, old])
    await db_session.flush()

    results = await list_documents(
        db_session, date_from=local_today() - timedelta(days=1), date_to=local_today()
    )

    result_ids = {d.id for d in results}
    assert recent.id in result_ids
    assert old.id not in result_ids


async def test_list_documents_handler_keyword_filter(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    matching = _make_doc(org, creator, handler_name="王小明")
    non_matching = _make_doc(org, creator, handler_name="陳大文")
    db_session.add_all([matching, non_matching])
    await db_session.flush()

    results = await list_documents(db_session, handler_keyword="王小明")

    assert {d.id for d in results} == {matching.id}


async def test_list_documents_recipient_keyword_filter(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = _make_doc(org, creator)
    other = _make_doc(org, creator)
    db_session.add_all([doc, other])
    await db_session.flush()
    db_session.add(
        DocumentRecipient(
            document_id=doc.id,
            recipient_type=RecipientType.MAIN,
            name="教育部",
        )
    )
    await db_session.flush()

    results = await list_documents(db_session, recipient_keyword="教育部")

    assert {d.id for d in results} == {doc.id}
