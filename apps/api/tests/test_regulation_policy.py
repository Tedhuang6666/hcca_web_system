from __future__ import annotations

import uuid
from io import BytesIO
from zipfile import ZipFile

import pytest

from api.models.regulation import ArticleType, RegulationWorkflowStatus
from api.schemas.regulation import RegulationArticleCreate, RegulationPublishRequest
from api.services import regulation as reg_svc
from api.services.regulation_consistency import audit_regulation_document_consistency
from api.services.regulation_import import parse_regulation_document, parse_regulation_docx


def _build_docx(lines: list[str]) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in lines)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    buf = BytesIO()
    with ZipFile(buf, "w") as docx:
        docx.writestr("[Content_Types].xml", content_types)
        docx.writestr("word/document.xml", document_xml)
    return buf.getvalue()


def test_create_article_with_legacy_type_rejected() -> None:
    with pytest.raises(ValueError):
        RegulationArticleCreate(
            sort_index=10,
            article_type="clause",
            title="第一條",
            content="測試",
        )


def test_parse_regulation_docx_maps_legal_document_to_articles() -> None:
    raw = _build_docx(
        [
            "國立新竹高級中學學生代表法",
            "114 年 12 月 15 日學生議會制訂通過",
            "第一章總則",
            "第一條本法依《高級中等教育法》制定之。",
            "第二條學生代表之職權如下：一、出席會議。二、提出建議。",
            "第二章選舉罷免與離職",
            "第一節選舉",
            "第三條學生代表應具會員身分。",
        ]
    )

    draft = parse_regulation_docx(raw, "學生代表法.docx")

    assert draft.title == "國立新竹高級中學學生代表法"
    assert draft.legislative_history == "114 年 12 月 15 日學生議會制訂通過"
    assert [row.article_type for row in draft.articles] == [
        ArticleType.CHAPTER,
        ArticleType.ARTICLE,
        ArticleType.ARTICLE,
        ArticleType.SUBPARAGRAPH,
        ArticleType.SUBPARAGRAPH,
        ArticleType.CHAPTER,
        ArticleType.SECTION,
        ArticleType.ARTICLE,
    ]
    assert draft.articles[1].legal_number == "1"
    assert draft.articles[2].content == "學生代表之職權如下："
    assert draft.articles[3].parent_key == draft.articles[2].key
    assert draft.articles[3].legal_number == "1"
    assert draft.articles[4].content == "提出建議。"


def test_parse_regulation_pdf_maps_text_pdf_to_articles(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePage:
        def extract_text(self) -> str:
            return "\n".join(
                [
                    "國立新竹高級中學學生代表法",
                    "114 年 12 月 15 日學生議會制訂通過",
                    "第一章總則",
                    "第一條本法依《高級中等教育法》制定之。",
                    "第二條學生代表之職權如下：",
                    "一、出席會議。",
                    "二、提出建議。",
                ]
            )

    class FakePdfReader:
        def __init__(self, _stream: BytesIO) -> None:
            self.pages = [FakePage()]

    monkeypatch.setattr("api.services.regulation_import.PdfReader", FakePdfReader)

    draft = parse_regulation_document(b"%PDF", "學生代表法.pdf")

    assert draft.title == "國立新竹高級中學學生代表法"
    assert draft.articles[0].article_type == ArticleType.CHAPTER
    assert draft.articles[1].legal_number == "1"
    assert draft.articles[2].legal_number == "2"
    assert draft.articles[2].content == "學生代表之職權如下："
    assert draft.articles[3].article_type == ArticleType.SUBPARAGRAPH
    assert draft.articles[3].content == "出席會議。"


@pytest.mark.asyncio
async def test_publish_regulation_disabled_requires_president_publish() -> None:
    with pytest.raises(ValueError, match="president_publish"):
        await reg_svc.publish_regulation(
            session=None,  # type: ignore[arg-type]
            reg=None,  # type: ignore[arg-type]
            data=RegulationPublishRequest(change_brief="test"),
            published_by=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_transition_reject_requires_note() -> None:
    from api.models.regulation import Regulation, RegulationCategory

    class FakeSession:
        def add(self, _obj) -> None:
            return None

        async def flush(self) -> None:
            return None

    reg = Regulation(
        title="測試法規",
        category=RegulationCategory.EXECUTIVE_DEPT,
        content="",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        workflow_status=RegulationWorkflowStatus.UNDER_REVIEW,
    )

    with pytest.raises(ValueError, match="退回法規必須填寫退回原因"):
        await reg_svc.transition_workflow(
            FakeSession(),  # type: ignore[arg-type]
            reg,
            to_status=RegulationWorkflowStatus.REJECTED,
            actor_id=uuid.uuid4(),
            note="",
        )


@pytest.mark.asyncio
async def test_consistency_audit_flags_missing_published_document() -> None:
    from api.models.regulation import Regulation, RegulationCategory

    class _ScalarResult:
        def __init__(self, items):
            self._items = items

        def scalars(self):
            return self

        def all(self):
            return self._items

    class FakeSession:
        def __init__(self, regs):
            self._regs = regs
            self._exec_calls = 0

        async def execute(self, _stmt):
            self._exec_calls += 1
            if self._exec_calls == 1:
                return _ScalarResult(self._regs)
            return _ScalarResult([])

        async def get(self, _model, _id):
            return None

    reg = Regulation(
        title="測試法規",
        category=RegulationCategory.EXECUTIVE_DEPT,
        content="",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
    )
    reg.published_document_id = None
    result = await audit_regulation_document_consistency(FakeSession([reg]))  # type: ignore[arg-type]
    assert result["problem_count"] >= 1
    assert any(p["type"] == "published_regulation_missing_document" for p in result["problems"])
