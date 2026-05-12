"""公文服務層單元測試 - 使用 AsyncMock 隔離資料庫"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentStatus,
)
from api.schemas.document import DocumentCreate, DocumentUpdate
from api.services.document import (
    _get_current_approval,
    approve_step,
    create_document,
    reject_step,
    submit_document,
    update_document,
)

# ── Fixtures ───────────────────────────────────────────────────────────────────


def _make_session() -> AsyncMock:
    """建立假的 AsyncSession"""
    session = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.delete = AsyncMock()
    return session


def _make_draft_doc(created_by: uuid.UUID | None = None) -> MagicMock:
    """建立草稿狀態的公文 Mock（避免 SQLAlchemy ORM 初始化依賴）"""
    doc = MagicMock(spec=Document)
    doc.id = uuid.uuid4()
    doc.serial_number = "DOC-2026-000001"
    doc.title = "測試公文"
    doc.content = "# 內容"
    doc.status = DocumentStatus.DRAFT
    doc.current_step = 0
    doc.org_id = uuid.uuid4()
    doc.created_by = created_by or uuid.uuid4()
    doc.submitted_at = None
    doc.completed_at = None
    doc.serial_template_id = None
    return doc


def _make_pending_doc() -> MagicMock:
    doc = _make_draft_doc()
    doc.status = DocumentStatus.PENDING
    doc.current_step = 1
    doc.submitted_at = datetime.now(UTC)
    return doc


def _make_create_payload(**kwargs: object) -> DocumentCreate:
    """建立 DocumentCreate 請求體，支援覆寫任意欄位"""
    defaults: dict = {
        "title": "測試公文",
        "org_id": uuid.uuid4(),
        "subject": "為測試公文建立流程，請 鑒核。",
        "content": "## 草稿",
    }
    defaults.update(kwargs)
    return DocumentCreate(**defaults)


def _make_update_payload(**kwargs: object) -> DocumentUpdate:
    """建立 DocumentUpdate 請求體"""
    return DocumentUpdate(**kwargs)


# ── 建立公文 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_document_generates_serial() -> None:
    """create_document 應自動生成字號並建立初始版本"""
    session = _make_session()

    # 服務層呼叫 generate_serial_number，mock 回傳固定值
    async def return_created_document(*_: object) -> Document:
        return session.add.call_args_list[0].args[0]

    with (
        patch("api.services.document.generate_serial_number", return_value="DOC-2026-000001"),
        patch("api.services.document.get_document", side_effect=return_created_document),
    ):
        doc = await create_document(
            session,
            data=_make_create_payload(),
            created_by=uuid.uuid4(),
        )

    assert doc.serial_number == "DOC-2026-000001"
    assert doc.status == DocumentStatus.DRAFT
    # session.add 被呼叫 2 次：Document + DocumentRevision（初稿）
    assert session.add.call_count == 2


# ── 更新草稿 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_document_draft_ok() -> None:
    """草稿狀態的公文可以被更新"""
    session = _make_session()
    # Mock 版本號查詢（SELECT max(revision_number)）
    mock_result = MagicMock()
    mock_result.scalar_one.return_value = 1
    session.execute = AsyncMock(return_value=mock_result)

    doc = _make_draft_doc()
    updated = await update_document(
        session,
        doc,
        data=_make_update_payload(title="新標題", content="新內容", change_note="測試修改"),
        changed_by=uuid.uuid4(),
    )

    assert updated.title == "新標題"
    assert updated.content == "新內容"
    session.add.assert_called_once()  # 新版本 DocumentRevision


@pytest.mark.asyncio
async def test_update_document_pending_raises() -> None:
    """待審核狀態的公文不可更新"""
    session = _make_session()
    doc = _make_pending_doc()

    with pytest.raises(ValueError, match="非草稿狀態"):
        await update_document(
            session,
            doc,
            data=_make_update_payload(title="改標題"),
            changed_by=uuid.uuid4(),
        )


# ── 送審 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_submit_document_creates_approval_steps() -> None:
    """送審應建立對應數量的審核步驟"""
    session = _make_session()
    doc = _make_draft_doc()
    approvers = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]

    with patch("api.services.document._resolve_active_delegate_assignment", return_value=None):
        await submit_document(session, doc, approver_ids=approvers)

    assert doc.status == DocumentStatus.PENDING
    assert doc.submitted_at is not None
    assert doc.current_step == 1
    assert session.add.call_count == 3  # 3 個步驟


@pytest.mark.asyncio
async def test_submit_document_requires_approvers() -> None:
    """送審時審核人清單不可為空"""
    session = _make_session()
    doc = _make_draft_doc()

    with pytest.raises(ValueError, match="至少需要一位"):
        await submit_document(session, doc, approver_ids=[])


@pytest.mark.asyncio
async def test_submit_non_draft_raises() -> None:
    """非草稿狀態無法送審"""
    session = _make_session()
    doc = _make_pending_doc()

    with pytest.raises(ValueError, match="非草稿狀態"):
        await submit_document(session, doc, approver_ids=[uuid.uuid4()])


# ── 核准 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_approve_last_step_sets_approved() -> None:
    """核准最後一關後文件狀態應變為 APPROVED"""
    session = _make_session()
    approver_id = uuid.uuid4()
    doc = _make_pending_doc()

    # 模擬 _get_current_approval 回傳一個步驟
    current_approval = MagicMock(spec=DocumentApproval)
    current_approval.status = ApprovalStepStatus.PENDING
    current_approval.comment = None
    current_approval.decided_at = None

    mock_current = MagicMock()
    mock_current.scalar_one_or_none.return_value = current_approval

    # 模擬沒有下一個步驟（最後一關）
    mock_next = MagicMock()
    mock_next.scalar_one_or_none.return_value = None

    session.execute = AsyncMock(side_effect=[mock_current, mock_next])

    await approve_step(session, doc, approver_id=approver_id, comment="同意")

    assert doc.status == DocumentStatus.APPROVED
    assert doc.completed_at is not None
    assert current_approval.status == ApprovalStepStatus.APPROVED


@pytest.mark.asyncio
async def test_approve_non_pending_raises() -> None:
    """非待審核狀態無法核准"""
    session = _make_session()
    doc = _make_draft_doc()

    with pytest.raises(ValueError, match="非待審核狀態"):
        await approve_step(session, doc, approver_id=uuid.uuid4())


# ── 退件 ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reject_sets_rejected_and_skips_remaining() -> None:
    """退件後文件變 REJECTED，後續步驟設為 SKIPPED"""
    session = _make_session()
    approver_id = uuid.uuid4()
    doc = _make_pending_doc()

    current_approval = MagicMock(spec=DocumentApproval)
    current_approval.status = ApprovalStepStatus.PENDING
    current_approval.comment = None
    current_approval.decided_at = None

    remaining = MagicMock(spec=DocumentApproval)
    remaining.status = ApprovalStepStatus.WAITING

    mock_current = MagicMock()
    mock_current.scalar_one_or_none.return_value = current_approval

    mock_remaining_result = MagicMock()
    mock_remaining_result.scalars.return_value.all.return_value = [remaining]

    session.execute = AsyncMock(side_effect=[mock_current, mock_remaining_result])

    await reject_step(session, doc, approver_id=approver_id, comment="內容有誤，請修正")

    assert doc.status == DocumentStatus.REJECTED
    assert doc.completed_at is not None
    assert current_approval.status == ApprovalStepStatus.REJECTED
    assert remaining.status == ApprovalStepStatus.SKIPPED


@pytest.mark.asyncio
async def test_get_current_approval_allows_active_assignment_delegate() -> None:
    """有效的請假代理人應可代行當前待審步驟。"""
    session = _make_session()
    approver_id = uuid.uuid4()
    delegate_id = uuid.uuid4()
    doc = _make_pending_doc()

    approval = MagicMock(spec=DocumentApproval)
    approval.approver_id = approver_id
    approval.delegate_id = delegate_id
    approval.delegate_source = DelegateSource.ASSIGNMENT
    approval.status = ApprovalStepStatus.PENDING

    result = MagicMock()
    result.scalar_one_or_none.return_value = approval
    session.execute = AsyncMock(return_value=result)

    assignment = MagicMock()
    assignment.delegate_user_id = delegate_id

    with patch(
        "api.services.document._resolve_active_delegate_assignment", return_value=assignment
    ):
        current, is_acting = await _get_current_approval(session, doc, delegate_id)

    assert current is approval
    assert is_acting is True


@pytest.mark.asyncio
async def test_get_current_approval_blocks_expired_assignment_delegate() -> None:
    """過期的請假代理人不可再代行審核。"""
    session = _make_session()
    approver_id = uuid.uuid4()
    delegate_id = uuid.uuid4()
    doc = _make_pending_doc()

    approval = MagicMock(spec=DocumentApproval)
    approval.approver_id = approver_id
    approval.delegate_id = delegate_id
    approval.delegate_source = DelegateSource.ASSIGNMENT
    approval.status = ApprovalStepStatus.PENDING

    result = MagicMock()
    result.scalar_one_or_none.return_value = approval
    session.execute = AsyncMock(return_value=result)

    with patch("api.services.document._resolve_active_delegate_assignment", return_value=None):
        current, is_acting = await _get_current_approval(session, doc, delegate_id)

    assert current is None
    assert is_acting is False


@pytest.mark.asyncio
async def test_local_storage_rejects_unsupported_type() -> None:
    """LocalStorageBackend 應拒絕不支援的 MIME 類型"""
    import shutil

    from api.services.storage import LocalStorageBackend

    backend = LocalStorageBackend(base_dir="test_uploads_tmp")

    # 用 MagicMock 模擬 UploadFile（避免 content_type 只讀的問題）
    fake_file = MagicMock()
    fake_file.filename = "malware.exe"
    fake_file.content_type = "application/x-executable"
    fake_file.read = AsyncMock(return_value=b"MZ\x00\x00")

    with pytest.raises(ValueError, match="不支援的檔案類型"):
        await backend.save(fake_file)

    shutil.rmtree("test_uploads_tmp", ignore_errors=True)
