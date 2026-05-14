"""Document batch operation route tests."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import ApprovalStepStatus, Document, DocumentApproval, DocumentStatus
from api.models.org import Org
from api.models.user import User
from api.routers.documents import (
    batch_approve_documents,
    batch_archive_documents,
    batch_reject_documents,
)
from api.schemas.document import BatchApproveRequest, BatchArchiveRequest, BatchRejectRequest


@pytest.mark.asyncio
async def test_batch_approve_returns_per_document_results(db_session: AsyncSession) -> None:
    org = Org(name="審核組", prefix="審")
    creator = User(email="batch-creator@example.com", display_name="Creator")
    approver = User(email="batch-approver@example.com", display_name="Approver")
    db_session.add_all([org, creator, approver])
    await db_session.flush()

    pending_doc = Document(
        serial_number="DOC-2026-100001",
        title="待批量核准",
        org_id=org.id,
        created_by=creator.id,
        status=DocumentStatus.PENDING,
        current_step=1,
        subject="為測試批量核准流程，請 鑒核。",
    )
    draft_doc = Document(
        serial_number="DOC-2026-100002",
        title="不可核准草稿",
        org_id=org.id,
        created_by=creator.id,
        status=DocumentStatus.DRAFT,
        subject="為測試批量核准失敗，請 鑒核。",
    )
    db_session.add_all([pending_doc, draft_doc])
    await db_session.flush()
    db_session.add(
        DocumentApproval(
            document_id=pending_doc.id,
            approver_id=approver.id,
            step_order=1,
            status=ApprovalStepStatus.PENDING,
        )
    )
    await db_session.flush()

    result = await batch_approve_documents(
        BatchApproveRequest(document_ids=[pending_doc.id, draft_doc.id], comment="同意"),
        db_session,
        approver,
        BackgroundTasks(),
    )

    assert result.succeeded == 1
    assert result.failed == 1
    assert result.results[0].ok is True
    assert result.results[0].status == DocumentStatus.APPROVED
    assert result.results[1].ok is False
    assert result.results[1].detail == "只有待審核公文可以批量核准"


@pytest.mark.asyncio
async def test_batch_reject_skips_already_approved_document(db_session: AsyncSession) -> None:
    org = Org(name="退件組", prefix="退")
    creator = User(email="batch-reject-creator@example.com", display_name="Creator")
    approver = User(email="batch-reject-approver@example.com", display_name="Approver")
    db_session.add_all([org, creator, approver])
    await db_session.flush()

    approved_doc = Document(
        serial_number="DOC-2026-100003",
        title="已核准不可退件",
        org_id=org.id,
        created_by=creator.id,
        status=DocumentStatus.APPROVED,
        current_step=1,
        subject="已經核准並發出，不可再批量退件。",
    )
    db_session.add(approved_doc)
    await db_session.flush()

    result = await batch_reject_documents(
        BatchRejectRequest(document_ids=[approved_doc.id], comment="退件"),
        db_session,
        approver,
        BackgroundTasks(),
    )

    assert result.succeeded == 0
    assert result.failed == 1
    assert result.results[0].ok is False
    assert result.results[0].status == DocumentStatus.APPROVED
    assert result.results[0].detail == "只有待審核公文可以批量退件"


@pytest.mark.asyncio
async def test_batch_archive_deduplicates_document_ids(db_session: AsyncSession) -> None:
    org = Org(name="封存組", prefix="封")
    user = User(email="batch-archive@example.com", display_name="Archiver")
    db_session.add_all([org, user])
    await db_session.flush()
    doc = Document(
        serial_number="DOC-2026-200001",
        title="已核准待封存",
        org_id=org.id,
        created_by=user.id,
        status=DocumentStatus.APPROVED,
        subject="為測試批量封存流程，請 鑒核。",
    )
    db_session.add(doc)
    await db_session.flush()

    result = await batch_archive_documents(
        BatchArchiveRequest(document_ids=[doc.id, doc.id, uuid4()]),
        db_session,
        user,
        BackgroundTasks(),
    )

    assert result.total == 2
    assert result.succeeded == 1
    assert result.failed == 1
    assert result.results[0].status == DocumentStatus.ARCHIVED
    assert result.results[1].detail == "找不到此公文"
