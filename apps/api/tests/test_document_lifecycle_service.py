"""公文服務層（_lifecycle.py）狀態機測試 — 使用真實 DB session，不 mock 資料庫。

涵蓋：建立（自動字號 / 手動字號 / 模板字號）、草稿更新（含 autosave 不建版本）、
送審、核准（多關卡推進 / 最後一關完成）、退件（至承辦人 / 退回上一關）、
撤回、封存、刪除、受文者覆寫、請假代理授權 CRUD 與 set_delegate。

test_document_service.py 用 AsyncMock 隔離 DB 測過純邏輯分支；本檔改用
db_session 走真實資料庫交易，驗證與 Postgres 互動（with_for_update 鎖、
唯一約束、關聯載入）正確無誤。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import local_today
from api.models.document import (
    ApprovalStepStatus,
    Document,
    DocumentSerialTemplate,
    DocumentStatus,
    DocumentVisibility,
    YearMode,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.models.school_class import SchoolClass
from api.models.user import User
from api.schemas.document import (
    DocumentApprovalDelegationCreate,
    DocumentApprovalDelegationUpdate,
    DocumentCreate,
    DocumentUpdate,
    RecipientCreate,
)
from api.services.document import (
    approve_step,
    archive_document,
    create_approval_delegation,
    create_document,
    deactivate_approval_delegation,
    delete_document,
    issue_document_directly,
    list_approval_delegations,
    recall_document,
    reject_step,
    reject_to_previous_step,
    resolve_recipient_match,
    set_delegate,
    submit_document,
    suggest_approvers,
    update_approval_delegation,
    update_document,
    upsert_recipients,
)

pytestmark = pytest.mark.asyncio


# ── Fixtures / helpers ───────────────────────────────────────────────────────


async def _make_org(db_session: AsyncSession, **overrides: object) -> Org:
    defaults: dict = {"name": f"測試組織-{uuid.uuid4().hex[:6]}"}
    defaults.update(overrides)
    org = Org(**defaults)
    db_session.add(org)
    await db_session.flush()
    return org


async def _grant_position(
    db_session: AsyncSession,
    user: User,
    org: Org,
    *,
    permission_code: str | None = None,
    start_date=None,
    end_date=None,
) -> Position:
    """給 user 建立一個組織成員任期（可選帶權限碼）。"""
    position = Position(org_id=org.id, name=f"職位-{uuid.uuid4().hex[:6]}")
    db_session.add(position)
    await db_session.flush()
    if permission_code:
        db_session.add(Permission(position_id=position.id, code=permission_code))
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


def _create_payload(org: Org, **overrides: object) -> DocumentCreate:
    defaults: dict = {
        "title": "測試公文",
        "org_id": org.id,
        "subject": "為測試公文流程，特此簽陳，請 鑒核。",
        "content": "內容",
    }
    defaults.update(overrides)
    return DocumentCreate(**defaults)


async def _make_draft(
    db_session: AsyncSession, org: Org, creator: User, **overrides: object
) -> Document:
    return await create_document(
        db_session, data=_create_payload(org, **overrides), created_by=creator.id
    )


# ── create_document ──────────────────────────────────────────────────────────


async def test_create_document_auto_generates_draft_serial(
    db_session: AsyncSession, make_user
) -> None:
    """未指定手動字號或模板時，應以 DRAFT-YYYYMMDD-xxxx 格式自動產生字號。"""
    org = await _make_org(db_session)
    creator = await make_user()

    doc = await _make_draft(db_session, org, creator)

    assert doc.serial_number.startswith("DRAFT-")
    assert doc.status == DocumentStatus.DRAFT
    assert len(doc.revisions) == 1
    assert doc.revisions[0].change_note == "初稿建立"


async def test_create_document_rejects_class_org(db_session: AsyncSession, make_user) -> None:
    class_org = await _make_org(db_session, name="115 學年度 301 班")
    creator = await make_user()
    db_session.add(
        SchoolClass(
            academic_year=115,
            class_code="301",
            grade=3,
            created_by=creator.id,
            org_id=class_org.id,
        )
    )
    await db_session.flush()

    with pytest.raises(ValueError, match="班級不是發文機關"):
        await _make_draft(db_session, class_org, creator)


async def test_create_document_accepts_class_recipient(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    school_class = SchoolClass(
        academic_year=115,
        class_code="302",
        grade=3,
        created_by=creator.id,
    )
    db_session.add(school_class)
    await db_session.flush()

    doc = await _make_draft(
        db_session,
        org,
        creator,
        recipients=[
            RecipientCreate(
                recipient_type="main",
                name="115 學年度 302 班",
                target_class_id=school_class.id,
            )
        ],
    )

    assert doc.recipients[0].target_class_id == school_class.id


async def test_create_document_manual_serial_rejects_duplicate(
    db_session: AsyncSession, make_user
) -> None:
    """手動指定的字號若已存在，應拒絕建立。"""
    org = await _make_org(db_session)
    creator = await make_user()
    await _make_draft(db_session, org, creator, manual_serial_number="DOC-DUP-0001")

    with pytest.raises(ValueError, match="已存在"):
        await _make_draft(db_session, org, creator, manual_serial_number="DOC-DUP-0001")


async def test_create_document_with_template_generates_templated_serial(
    db_session: AsyncSession, make_user
) -> None:
    """指定字號模板時，應由模板產生正式格式字號並遞增流水號。"""
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    template = DocumentSerialTemplate(
        org_id=org.id,
        org_prefix="嶺代",
        category_char="生",
        year_mode=YearMode.ROC,
        current_year=115,
        counter=0,
        is_active=True,
        created_by=creator.id,
    )
    db_session.add(template)
    await db_session.flush()

    doc = await _make_draft(db_session, org, creator, serial_template_id=template.id)

    assert "嶺代生字第" in doc.serial_number
    assert doc.serial_template_id == template.id


async def test_create_document_with_inactive_template_raises(
    db_session: AsyncSession, make_user
) -> None:
    """已停用的字號模板不可用於建立公文。"""
    org = await _make_org(db_session, prefix="嶺代")
    creator = await make_user()
    template = DocumentSerialTemplate(
        org_id=org.id,
        org_prefix="嶺代",
        category_char="生",
        year_mode=YearMode.ROC,
        current_year=115,
        counter=0,
        is_active=False,
        created_by=creator.id,
    )
    db_session.add(template)
    await db_session.flush()

    with pytest.raises(ValueError, match="不存在或已停用"):
        await _make_draft(db_session, org, creator, serial_template_id=template.id)


async def test_create_document_with_template_from_other_org_raises_permission_error(
    db_session: AsyncSession, make_user
) -> None:
    """字號模板不屬於指定組織時應拒絕（PermissionError）。"""
    org = await _make_org(db_session, prefix="嶺代")
    other_org = await _make_org(db_session, prefix="嶺學")
    creator = await make_user()
    template = DocumentSerialTemplate(
        org_id=other_org.id,
        org_prefix="嶺學",
        category_char="生",
        year_mode=YearMode.ROC,
        current_year=115,
        counter=0,
        is_active=True,
        created_by=creator.id,
    )
    db_session.add(template)
    await db_session.flush()

    with pytest.raises(PermissionError, match="不屬於此組織"):
        await _make_draft(db_session, org, creator, serial_template_id=template.id)


async def test_create_document_sets_is_public_for_publicly_open_visibility(
    db_session: AsyncSession, make_user
) -> None:
    """visibility_level=publicly_open 時 is_public 應自動同步為 True。"""
    org = await _make_org(db_session)
    creator = await make_user()

    doc = await _make_draft(
        db_session, org, creator, visibility_level=DocumentVisibility.PUBLICLY_OPEN
    )

    assert doc.is_public is True


# ── update_document ──────────────────────────────────────────────────────────


async def test_update_document_creates_new_revision_when_changed(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)

    updated = await update_document(
        db_session,
        doc,
        data=DocumentUpdate(title="新標題", change_note="修正標題"),
        changed_by=creator.id,
    )

    assert updated.title == "新標題"
    await db_session.refresh(updated, attribute_names=["revisions"])
    assert len(updated.revisions) == 2
    assert updated.revisions[-1].change_note == "修正標題"


async def test_update_document_autosave_does_not_create_revision(
    db_session: AsyncSession, make_user
) -> None:
    """autosave=True 時即使內容變更也不應建立新的版本快照。"""
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)

    updated = await update_document(
        db_session,
        doc,
        data=DocumentUpdate(content="自動儲存內容", autosave=True),
        changed_by=creator.id,
    )

    assert updated.content == "自動儲存內容"
    assert len(updated.revisions) == 1


async def test_update_document_non_draft_raises(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    with pytest.raises(ValueError, match="非草稿狀態"):
        await update_document(
            db_session, doc, data=DocumentUpdate(title="不可改"), changed_by=creator.id
        )


# ── submit_document / issue_document_directly ───────────────────────────────


async def test_submit_document_creates_ordered_approval_steps(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    a1, a2 = await make_user(), await make_user()
    doc = await _make_draft(db_session, org, creator)

    submitted = await submit_document(db_session, doc, approver_ids=[a1.id, a2.id])
    await db_session.refresh(submitted, attribute_names=["approvals"])

    assert submitted.status == DocumentStatus.PENDING
    assert submitted.current_step == 1
    steps = sorted(submitted.approvals, key=lambda a: a.step_order)
    assert [s.status for s in steps] == [ApprovalStepStatus.PENDING, ApprovalStepStatus.WAITING]


async def test_submit_document_without_approvers_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)

    with pytest.raises(ValueError, match="至少需要一位"):
        await submit_document(db_session, doc, approver_ids=[])


async def test_issue_document_directly_marks_approved_immediately(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)

    issued = await issue_document_directly(
        db_session, doc, issued_by=creator.id, comment="急件直發"
    )

    assert issued.status == DocumentStatus.APPROVED
    assert issued.issued_at is not None
    assert issued.completed_at is not None


async def test_issue_document_directly_non_draft_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await issue_document_directly(db_session, doc, issued_by=creator.id)

    with pytest.raises(ValueError, match="非草稿狀態"):
        await issue_document_directly(db_session, doc, issued_by=creator.id)


# ── suggest_approvers ────────────────────────────────────────────────────────


async def test_suggest_approvers_returns_users_with_approve_permission(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    approver = await make_user(display_name="核准人")
    non_approver = await make_user(display_name="無權限")
    await _grant_position(db_session, approver, org, permission_code="document:approve")
    await _grant_position(db_session, non_approver, org, permission_code="document:view")

    candidates = await suggest_approvers(db_session, org.id)

    candidate_ids = {u.id for u in candidates}
    assert approver.id in candidate_ids
    assert non_approver.id not in candidate_ids


async def test_suggest_approvers_excludes_expired_tenure(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    expired = await make_user(display_name="已離任")
    await _grant_position(
        db_session,
        expired,
        org,
        permission_code="document:approve",
        start_date=local_today() - timedelta(days=100),
        end_date=local_today() - timedelta(days=10),
    )

    candidates = await suggest_approvers(db_session, org.id)

    assert expired.id not in {u.id for u in candidates}


# ── approve_step / reject_step / reject_to_previous_step ───────────────────


async def test_approve_step_advances_to_next_step(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    a1, a2 = await make_user(), await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[a1.id, a2.id])

    result = await approve_step(db_session, doc, approver_id=a1.id, comment="同意")
    await db_session.refresh(result, attribute_names=["approvals"])

    assert result.status == DocumentStatus.PENDING
    assert result.current_step == 2
    steps = {s.step_order: s for s in result.approvals}
    assert steps[1].status == ApprovalStepStatus.APPROVED
    assert steps[2].status == ApprovalStepStatus.PENDING


async def test_approve_step_last_step_completes_document(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    result = await approve_step(db_session, doc, approver_id=approver.id)

    assert result.status == DocumentStatus.APPROVED
    assert result.completed_at is not None


async def test_approve_step_wrong_approver_raises_permission_error(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    stranger = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    with pytest.raises(PermissionError):
        await approve_step(db_session, doc, approver_id=stranger.id)


async def test_approve_step_non_pending_document_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)

    with pytest.raises(ValueError, match="非待審核狀態"):
        await approve_step(db_session, doc, approver_id=creator.id)


async def test_reject_step_sets_rejected_and_skips_remaining_steps(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    a1, a2 = await make_user(), await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[a1.id, a2.id])

    result = await reject_step(db_session, doc, approver_id=a1.id, comment="內容有誤，請修正")
    await db_session.refresh(result, attribute_names=["approvals"])

    assert result.status == DocumentStatus.REJECTED
    steps = {s.step_order: s for s in result.approvals}
    assert steps[1].status == ApprovalStepStatus.REJECTED
    assert steps[2].status == ApprovalStepStatus.SKIPPED


async def test_reject_to_previous_step_at_first_step_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    with pytest.raises(ValueError, match="第一關"):
        await reject_to_previous_step(db_session, doc, approver_id=approver.id, comment="退回")


async def test_reject_to_previous_step_moves_back_one_step(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    a1, a2 = await make_user(), await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[a1.id, a2.id])
    await approve_step(db_session, doc, approver_id=a1.id)

    result = await reject_to_previous_step(
        db_session, doc, approver_id=a2.id, comment="請補件後重審"
    )
    await db_session.refresh(result, attribute_names=["approvals"])

    assert result.status == DocumentStatus.PENDING
    assert result.current_step == 1
    steps = {s.step_order: s for s in result.approvals}
    assert steps[1].status == ApprovalStepStatus.PENDING
    assert steps[2].status == ApprovalStepStatus.REJECTED


# ── upsert_recipients ────────────────────────────────────────────────────────


async def test_upsert_recipients_replaces_existing_list(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(
        db_session,
        org,
        creator,
        recipients=[RecipientCreate(recipient_type="main", name="舊受文者")],
    )

    new_recipients = await upsert_recipients(
        db_session,
        doc,
        recipients=[RecipientCreate(recipient_type="copy", name="新副本收件者")],
    )

    assert len(new_recipients) == 1
    assert new_recipients[0].name == "新副本收件者"


async def test_upsert_recipients_non_draft_raises(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await issue_document_directly(db_session, doc, issued_by=creator.id)

    with pytest.raises(ValueError, match="草稿狀態"):
        await upsert_recipients(
            db_session, doc, recipients=[RecipientCreate(recipient_type="main", name="x")]
        )


# ── recall_document / archive_document / delete_document ───────────────────


async def test_recall_document_returns_to_draft_and_clears_approvals(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    result = await recall_document(db_session, doc, requested_by=creator.id)

    assert result.status == DocumentStatus.DRAFT
    assert result.current_step == 0
    assert result.approvals == []


async def test_recall_document_by_non_creator_raises_permission_error(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    stranger = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    with pytest.raises(PermissionError, match="建立者"):
        await recall_document(db_session, doc, requested_by=stranger.id)


async def test_recall_document_after_first_step_decided_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    a1, a2 = await make_user(), await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[a1.id, a2.id])
    await approve_step(db_session, doc, approver_id=a1.id)

    with pytest.raises(ValueError, match="已開始審核"):
        await recall_document(db_session, doc, requested_by=creator.id)


async def test_archive_document_requires_approved_status(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)

    with pytest.raises(ValueError, match="已核准狀態"):
        await archive_document(db_session, doc, requested_by=creator.id)


async def test_archive_document_success(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await issue_document_directly(db_session, doc, issued_by=creator.id)

    result = await archive_document(db_session, doc, requested_by=creator.id)

    assert result.status == DocumentStatus.ARCHIVED


async def test_delete_document_requires_draft_status(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await issue_document_directly(db_session, doc, issued_by=creator.id)

    with pytest.raises(ValueError, match="草稿狀態"):
        await delete_document(db_session, doc)


async def test_delete_document_removes_draft(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    doc = await _make_draft(db_session, org, creator)
    doc_id = doc.id

    await delete_document(db_session, doc)

    from api.services.document import get_document

    assert await get_document(db_session, doc_id) is None


# ── 請假代理授權 CRUD ─────────────────────────────────────────────────────────


async def test_create_approval_delegation_requires_active_membership(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    principal = await make_user()
    delegate = await make_user()
    # principal 沒有組織任期
    with pytest.raises(ValueError, match="不是該組織的有效成員"):
        await create_approval_delegation(
            db_session,
            principal_user_id=principal.id,
            created_by=principal.id,
            data=DocumentApprovalDelegationCreate(
                org_id=org.id,
                delegate_user_id=delegate.id,
                start_at=datetime.now(UTC),
            ),
        )


async def test_create_approval_delegation_rejects_self_delegate(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    principal = await make_user()
    await _grant_position(db_session, principal, org)

    with pytest.raises(ValueError, match="不得與被代理人相同"):
        await create_approval_delegation(
            db_session,
            principal_user_id=principal.id,
            created_by=principal.id,
            data=DocumentApprovalDelegationCreate(
                org_id=org.id,
                delegate_user_id=principal.id,
                start_at=datetime.now(UTC),
            ),
        )


async def test_create_approval_delegation_success_and_syncs_pending_approval(
    db_session: AsyncSession, make_user
) -> None:
    """建立代理授權後，principal 目前待審的公文步驟應自動帶入代理人。"""
    org = await _make_org(db_session)
    creator = await make_user()
    principal = await make_user()
    delegate = await make_user()
    await _grant_position(db_session, principal, org)
    await _grant_position(db_session, delegate, org)

    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[principal.id])

    delegation = await create_approval_delegation(
        db_session,
        principal_user_id=principal.id,
        created_by=principal.id,
        data=DocumentApprovalDelegationCreate(
            org_id=org.id,
            delegate_user_id=delegate.id,
            start_at=datetime.now(UTC) - timedelta(hours=1),
        ),
    )

    assert delegation.delegate_user_id == delegate.id
    await db_session.refresh(doc, attribute_names=["approvals"])
    pending_step = next(a for a in doc.approvals if a.step_order == 1)
    assert pending_step.delegate_id == delegate.id


async def test_create_approval_delegation_overlapping_period_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    principal = await make_user()
    d1 = await make_user()
    d2 = await make_user()
    await _grant_position(db_session, principal, org)
    await _grant_position(db_session, d1, org)
    await _grant_position(db_session, d2, org)

    now = datetime.now(UTC)
    await create_approval_delegation(
        db_session,
        principal_user_id=principal.id,
        created_by=principal.id,
        data=DocumentApprovalDelegationCreate(org_id=org.id, delegate_user_id=d1.id, start_at=now),
    )

    with pytest.raises(ValueError, match="已有有效的請假代理授權"):
        await create_approval_delegation(
            db_session,
            principal_user_id=principal.id,
            created_by=principal.id,
            data=DocumentApprovalDelegationCreate(
                org_id=org.id, delegate_user_id=d2.id, start_at=now + timedelta(hours=1)
            ),
        )


async def test_update_approval_delegation_rejects_self_delegate(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    principal = await make_user()
    delegate = await make_user()
    await _grant_position(db_session, principal, org)
    await _grant_position(db_session, delegate, org)
    delegation = await create_approval_delegation(
        db_session,
        principal_user_id=principal.id,
        created_by=principal.id,
        data=DocumentApprovalDelegationCreate(
            org_id=org.id, delegate_user_id=delegate.id, start_at=datetime.now(UTC)
        ),
    )

    with pytest.raises(ValueError, match="不得與被代理人相同"):
        await update_approval_delegation(
            db_session,
            delegation,
            data=DocumentApprovalDelegationUpdate(delegate_user_id=principal.id),
        )


async def test_update_approval_delegation_end_before_start_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    principal = await make_user()
    delegate = await make_user()
    await _grant_position(db_session, principal, org)
    await _grant_position(db_session, delegate, org)
    now = datetime.now(UTC)
    delegation = await create_approval_delegation(
        db_session,
        principal_user_id=principal.id,
        created_by=principal.id,
        data=DocumentApprovalDelegationCreate(
            org_id=org.id, delegate_user_id=delegate.id, start_at=now
        ),
    )

    with pytest.raises(ValueError, match="不得早於開始時間"):
        await update_approval_delegation(
            db_session,
            delegation,
            data=DocumentApprovalDelegationUpdate(end_at=now - timedelta(days=1)),
        )


async def test_deactivate_approval_delegation_clears_active_flag_and_syncs(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    principal = await make_user()
    delegate = await make_user()
    await _grant_position(db_session, principal, org)
    await _grant_position(db_session, delegate, org)

    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[principal.id])
    delegation = await create_approval_delegation(
        db_session,
        principal_user_id=principal.id,
        created_by=principal.id,
        data=DocumentApprovalDelegationCreate(
            org_id=org.id,
            delegate_user_id=delegate.id,
            start_at=datetime.now(UTC) - timedelta(hours=1),
        ),
    )

    await deactivate_approval_delegation(db_session, delegation)

    assert delegation.is_active is False
    await db_session.refresh(doc, attribute_names=["approvals"])
    pending_step = next(a for a in doc.approvals if a.step_order == 1)
    assert pending_step.delegate_id is None
    assert pending_step.delegate_source is None


async def test_list_approval_delegations_filters_by_principal(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    principal = await make_user()
    other_principal = await make_user()
    delegate = await make_user()
    for p in (principal, other_principal, delegate):
        await _grant_position(db_session, p, org)

    await create_approval_delegation(
        db_session,
        principal_user_id=principal.id,
        created_by=principal.id,
        data=DocumentApprovalDelegationCreate(
            org_id=org.id, delegate_user_id=delegate.id, start_at=datetime.now(UTC)
        ),
    )
    await create_approval_delegation(
        db_session,
        principal_user_id=other_principal.id,
        created_by=other_principal.id,
        data=DocumentApprovalDelegationCreate(
            org_id=org.id, delegate_user_id=delegate.id, start_at=datetime.now(UTC)
        ),
    )

    results = await list_approval_delegations(db_session, principal_user_id=principal.id)

    assert {d.principal_user_id for d in results} == {principal.id}


# ── set_delegate ─────────────────────────────────────────────────────────────


async def test_set_delegate_by_original_approver_success(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    delegate = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    approval = await set_delegate(
        db_session,
        doc,
        step_order=1,
        requesting_user_id=approver.id,
        delegate_id=delegate.id,
    )

    assert approval.delegate_id == delegate.id
    from api.models.document import DelegateSource

    assert approval.delegate_source == DelegateSource.MANUAL


async def test_set_delegate_by_non_approver_raises_permission_error(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    stranger = await make_user()
    delegate = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])

    with pytest.raises(PermissionError, match="不是此審核步驟的原始審核人"):
        await set_delegate(
            db_session,
            doc,
            step_order=1,
            requesting_user_id=stranger.id,
            delegate_id=delegate.id,
        )


async def test_set_delegate_after_step_completed_raises(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    approver = await make_user()
    delegate = await make_user()
    doc = await _make_draft(db_session, org, creator)
    await submit_document(db_session, doc, approver_ids=[approver.id])
    await approve_step(db_session, doc, approver_id=approver.id)

    with pytest.raises(ValueError, match="已完成"):
        await set_delegate(
            db_session,
            doc,
            step_order=1,
            requesting_user_id=approver.id,
            delegate_id=delegate.id,
        )


# ── resolve_recipient_match ──────────────────────────────────────────────────


async def test_resolve_recipient_match_by_target_user(db_session: AsyncSession, make_user) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    target_user = await make_user()
    doc = await _make_draft(
        db_session,
        org,
        creator,
        recipients=[
            RecipientCreate(recipient_type="main", name="指定收件人", target_user_id=target_user.id)
        ],
    )

    match = await resolve_recipient_match(db_session, doc, target_user.id)

    assert match is not None
    assert match.target_user_id == target_user.id


async def test_resolve_recipient_match_returns_none_when_no_match(
    db_session: AsyncSession, make_user
) -> None:
    org = await _make_org(db_session)
    creator = await make_user()
    stranger = await make_user()
    doc = await _make_draft(db_session, org, creator)

    match = await resolve_recipient_match(db_session, doc, stranger.id)

    assert match is None
