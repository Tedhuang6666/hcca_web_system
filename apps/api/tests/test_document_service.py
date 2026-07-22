"""公文服務層單元測試 - 使用 AsyncMock 隔離資料庫"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.models.document import (
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentCategory,
    DocumentClassification,
    DocumentStatus,
    DocumentVisibility,
    YearMode,
)
from api.schemas.document import (
    DocumentCreate,
    DocumentTemplateCreate,
    DocumentUpdate,
    SerialTemplateCreate,
)
from api.services.document import (
    _get_current_approval,
    approve_step,
    build_document_list_items,
    build_org_serial_prefix,
    can_anonymous_access_document,
    check_document_access,
    create_document,
    create_serial_template,
    reject_step,
    submit_document,
    update_document,
    update_serial_template,
)
from api.services.official_print import render_document_print_html

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


def _make_list_doc(**kwargs: object) -> Document:
    defaults = {
        "id": uuid.uuid4(),
        "serial_number": "DOC-2026-LIST",
        "title": "列表公文",
        "org_id": uuid.uuid4(),
        "created_by": uuid.uuid4(),
        "status": DocumentStatus.DRAFT,
        "urgency": "normal",
        "classification": "normal",
        "category": "letter",
        "subject": "為測試列表公文顯示，請 鑒核。",
        "created_at": datetime.now(UTC),
    }
    defaults.update(kwargs)
    doc = Document(**defaults)
    doc.approvals = []
    return doc


def _mock_scalars_result(items: list[object]) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value.all.return_value = items
    return result


def _mock_scalar_none_result() -> MagicMock:
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    return result


# ── 令格式驗證 ───────────────────────────────────────────────────────────────


def test_decree_create_defaults_issuer_title() -> None:
    """令可直接以正文起稿，並自動補上令前主詞。"""
    payload = _make_create_payload(
        category=DocumentCategory.DECREE,
        subject=None,
        doc_description="茲修正發布「學生自治組織設置辦法」第5條條文。",
    )

    assert payload.category == DocumentCategory.DECREE
    assert payload.subject is None
    assert payload.issuer_full_name == "主席"


def test_decree_template_allows_empty_subject() -> None:
    """令範本也可不填主旨。"""
    template = DocumentTemplateCreate(
        org_id=uuid.uuid4(),
        name="法規發布令",
        category=DocumentCategory.DECREE,
        subject=None,
        doc_description="茲修正發布「學生自治組織設置辦法」第5條條文。",
    )

    assert template.category == DocumentCategory.DECREE
    assert template.subject is None
    assert template.issuer_full_name == "主席"


def test_decree_update_defaults_issuer_title() -> None:
    payload = DocumentUpdate(category=DocumentCategory.DECREE)

    assert payload.issuer_full_name == "主席"


@pytest.mark.asyncio
async def test_decree_print_hides_empty_recipient_and_subject() -> None:
    """令列印格式不輸出空受文者，也不顯示主旨段落。"""
    doc = SimpleNamespace(
        title="法規發布令",
        issuer_full_name=None,
        org=SimpleNamespace(name="學生會"),
        category=DocumentCategory.DECREE,
        urgency="normal",
        classification="normal",
        declassification_condition="none",
        confidentiality_expires_at=None,
        recipients=[],
        attachments=[],
        issued_at=None,
        completed_at=None,
        created_at=datetime(2026, 5, 14, tzinfo=UTC),
        serial_number="竹中學字第115000021號",
        file_number=None,
        retention_period=None,
        handler_name="王大明",
        handler_unit="主席",
        handler_email=None,
        approvals=[],
        doc_description="茲修正發布「學生自治組織設置辦法」第5條條文。",
        content="",
        action_required=None,
        subject=None,
    )

    html = await render_document_print_html(_make_session(), doc)

    assert "發文字號：" in html
    assert "主席令" in re.sub(r"<[^>]+>", "", html)
    assert "茲修正發布" in html
    assert "受文者：" not in html
    assert "主旨：" not in html


# ── 建立公文 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_document_generates_serial() -> None:
    """create_document 應自動生成字號並建立初始版本"""
    session = _make_session()
    # 手動字號路徑會先查重；回傳 None 表示字號未被使用。
    session.scalar = AsyncMock(return_value=None)

    async def return_created_document(*_: object) -> Document:
        return session.add.call_args_list[0].args[0]

    with patch(
        "api.services.document._lifecycle.get_document", side_effect=return_created_document
    ):
        doc = await create_document(
            session,
            data=_make_create_payload(manual_serial_number="DOC-2026-000001"),
            created_by=uuid.uuid4(),
        )

    assert doc.serial_number == "DOC-2026-000001"
    assert doc.status == DocumentStatus.DRAFT
    # session.add 被呼叫 2 次：Document + DocumentRevision（初稿）
    assert session.add.call_count == 2


# ── 字號模板 ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_president_publish_template_clears_president_default_globally() -> None:
    """主席公布預設模板應全站唯一，不受組織限制。"""
    session = _make_session()
    org_id = uuid.uuid4()
    sibling_in_other_org = SimpleNamespace(is_default_president_publish=True)

    org_result = MagicMock()
    org_result.all.return_value = [SimpleNamespace(prefix="嶺班", name="主席團", depth=0)]
    sibling_result = _mock_scalars_result([sibling_in_other_org])
    session.execute = AsyncMock(side_effect=[org_result, sibling_result])

    template = await create_serial_template(
        session,
        data=SerialTemplateCreate(
            org_id=org_id,
            category_char="主公",
            year_mode=YearMode.ROC,
            is_default_president_publish=True,
        ),
        created_by=uuid.uuid4(),
    )

    assert template.is_default_president_publish is True
    assert sibling_in_other_org.is_default_president_publish is False


@pytest.mark.asyncio
async def test_build_org_serial_prefix_combines_ancestor_prefixes() -> None:
    """字號前綴應由上層到本層逐層組合。"""
    session = _make_session()
    result = MagicMock()
    result.all.return_value = [
        SimpleNamespace(prefix="嶺", name="嶺東高中", depth=2),
        SimpleNamespace(prefix="班", name="學生會", depth=1),
        SimpleNamespace(prefix="活", name="活動部", depth=0),
    ]
    session.execute = AsyncMock(return_value=result)

    prefix = await build_org_serial_prefix(session, uuid.uuid4())

    assert prefix == "嶺班活"


@pytest.mark.asyncio
async def test_update_president_publish_template_clears_president_default_globally() -> None:
    """更新主席公布預設時，也會清掉其他組織的主席公布預設。"""
    session = _make_session()
    template = SimpleNamespace(
        id=uuid.uuid4(),
        org_id=uuid.uuid4(),
        is_active=True,
        is_default=False,
        is_default_president_publish=False,
    )
    sibling_in_other_org = SimpleNamespace(is_default_president_publish=True)
    session.execute = AsyncMock(return_value=_mock_scalars_result([sibling_in_other_org]))

    updated = await update_serial_template(
        session,
        template,  # type: ignore[arg-type]
        updates={"is_default_president_publish": True},
    )

    assert updated.is_default_president_publish is True
    assert sibling_in_other_org.is_default_president_publish is False


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

    with patch(
        "api.services.document._access._resolve_active_delegate_assignment", return_value=None
    ):
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
        "api.services.document._lifecycle._resolve_active_delegate_assignment",
        return_value=assignment,
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

    with patch(
        "api.services.document._lifecycle._resolve_active_delegate_assignment", return_value=None
    ):
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


@pytest.mark.asyncio
async def test_public_normal_document_allows_logged_in_viewer() -> None:
    session = _make_session()
    session.scalar = AsyncMock(return_value=SimpleNamespace(email="viewer-public@example.com"))
    session.execute = AsyncMock(return_value=_mock_scalar_none_result())
    viewer_id = uuid.uuid4()

    doc = _make_list_doc(
        serial_number="DOC-2026-PUBLIC",
        title="登入公開公文",
        visibility_level=DocumentVisibility.PUBLIC,
    )

    assert await check_document_access(session, doc, viewer_id) is True


@pytest.mark.asyncio
async def test_sensitive_public_document_is_redacted_without_full_access() -> None:
    session = _make_session()
    session.scalar = AsyncMock(return_value=SimpleNamespace(email="viewer-secret@example.com"))
    session.execute = AsyncMock(return_value=_mock_scalar_none_result())
    viewer_id = uuid.uuid4()

    doc = _make_list_doc(
        serial_number="DOC-2026-SECRET",
        title="不可外洩標題",
        visibility_level=DocumentVisibility.PUBLICLY_OPEN,
        classification=DocumentClassification.SECRET,
        subject="不可外洩主旨",
    )

    assert can_anonymous_access_document(doc) is False
    assert await check_document_access(session, doc, viewer_id) is False

    [item] = await build_document_list_items(session, [doc], viewer_id=viewer_id)
    assert item.is_redacted is True
    assert item.title == "(此公文為密件)"
    assert item.subject is None


@pytest.mark.asyncio
async def test_sensitive_document_creator_sees_list_content() -> None:
    session = _make_session()
    creator_id = uuid.uuid4()

    doc = _make_list_doc(
        serial_number="DOC-2026-SECRET-FULL",
        title="建立者可見標題",
        created_by=creator_id,
        visibility_level=DocumentVisibility.PUBLIC,
        classification=DocumentClassification.CONFIDENTIAL,
        subject="建立者可見主旨",
    )

    [item] = await build_document_list_items(session, [doc], viewer_id=creator_id)
    assert item.is_redacted is False
    assert item.title == "建立者可見標題"
    assert item.subject == "建立者可見主旨"
