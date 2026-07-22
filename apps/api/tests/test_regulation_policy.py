from __future__ import annotations

import datetime as dt
import uuid
from io import BytesIO
from zipfile import ZipFile

import pytest

from api.models.org import Org
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowStatus,
)
from api.schemas.regulation import RegulationArticleCreate, RegulationPublishRequest
from api.services import regulation as reg_svc
from api.services.official_print import render_regulation_print_html
from api.services.regulation_consistency import audit_regulation_document_consistency
from api.services.regulation_import import (
    parse_regulation_document,
    parse_regulation_docx,
    parse_regulation_text,
)


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


def _build_docx_xml(document_xml: str) -> bytes:
    buf = BytesIO()
    with ZipFile(buf, "w") as docx:
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


def test_parse_regulation_docx_rejects_xml_entity_declarations() -> None:
    raw = _build_docx_xml(
        """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE document [<!ENTITY payload "expanded">]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>&payload;</w:t></w:r></w:p></w:body>
</w:document>"""
    )

    with pytest.raises(ValueError, match="不安全的 XML"):
        parse_regulation_docx(raw, "malicious.docx")


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


def test_parse_regulation_text_maps_nested_standalone_lines_precisely() -> None:
    draft = parse_regulation_text(
        title="學生自治組織辦法",
        content="\n".join(
            [
                "# 學生自治組織辦法",
                "第一章 總則",
                "第一條 本辦法規範學生自治組織。",
                "第二條 學生代表之職權如下：",
                "第一項 共同職權如下：",
                "一、出席會議。",
                "（一）完成簽到。",
                "二、提出建議。",
            ]
        ),
    )

    assert [row.article_type for row in draft.articles] == [
        ArticleType.CHAPTER,
        ArticleType.ARTICLE,
        ArticleType.ARTICLE,
        ArticleType.PARAGRAPH,
        ArticleType.SUBPARAGRAPH,
        ArticleType.ITEM,
        ArticleType.SUBPARAGRAPH,
    ]
    assert draft.articles[3].parent_key == draft.articles[2].key
    assert draft.articles[4].parent_key == draft.articles[3].key
    assert draft.articles[5].parent_key == draft.articles[4].key
    assert draft.articles[6].legal_number == "2"


def test_parse_regulation_docx_collects_history_heading_block() -> None:
    raw = _build_docx(
        [
            "學生會選舉罷免辦法",
            "歷史沿革",
            "中華民國 112 年 9 月 1 日學生議會通過",
            "2024.03.15 修正第二條",
            "第一條本辦法規範學生會選舉事項。",
        ]
    )

    draft = parse_regulation_docx(raw, "選罷辦法.docx")

    assert draft.legislative_history == "\n".join(
        [
            "中華民國 112 年 9 月 1 日學生議會通過",
            "2024.03.15 修正第二條",
        ]
    )
    assert draft.articles[0].legal_number == "1"


def test_regulation_print_renders_title_history_and_nested_numbering() -> None:
    reg_id = uuid.uuid4()
    reg = Regulation(
        id=reg_id,
        title="學生代表法",
        category=RegulationCategory.ORDINANCE,
        content="",
        legislative_history="114 年 12 月 15 日學生議會制訂通過",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
    )
    reg.org = Org(id=reg.org_id, name="學生會")
    reg.articles = [
        RegulationArticle(
            id=uuid.uuid4(),
            regulation_id=reg_id,
            sort_index=10,
            order_index=0,
            article_type=ArticleType.ARTICLE,
            legal_number="2",
            title="職權",
            content="學生代表職權如下：",
        ),
        RegulationArticle(
            id=uuid.uuid4(),
            regulation_id=reg_id,
            sort_index=20,
            order_index=0,
            article_type=ArticleType.PARAGRAPH,
            content="學生代表應出席會議。",
        ),
        RegulationArticle(
            id=uuid.uuid4(),
            regulation_id=reg_id,
            sort_index=30,
            order_index=0,
            article_type=ArticleType.SUBPARAGRAPH,
            legal_number="1",
            content="提出建議。",
        ),
        RegulationArticle(
            id=uuid.uuid4(),
            regulation_id=reg_id,
            sort_index=40,
            order_index=0,
            article_type=ArticleType.ITEM,
            legal_number="1",
            content="書面提出。",
        ),
    ]

    rendered = render_regulation_print_html(reg)

    assert "<div>學生代表法</div>" in rendered
    assert "國立新竹高級中學學生會" not in rendered
    assert rendered.index("<div>學生代表法</div>") < rendered.index(
        '<section class="legislative-history">'
    )
    assert rendered.index('<section class="legislative-history">') < rendered.index(
        '<section class="articles">'
    )
    assert "114 年 12 月 15 日學生議會制訂通過" in rendered
    assert "第二條" in rendered
    assert "第一項" in rendered
    assert "一、" in rendered
    assert "（一）" in rendered
    assert (
        '<span class="nested-label">第一項</span><span class="nested-body">學生代表應出席會議。'
        in rendered
    )
    assert '<span class="nested-label">一、</span><span class="nested-body">提出建議。' in rendered
    assert (
        '<span class="nested-label">（一）</span><span class="nested-body">書面提出。' in rendered
    )


def test_regulation_print_prefers_curated_history_and_standard_page_layout() -> None:
    reg = Regulation(
        id=uuid.uuid4(),
        title="國立新竹高級中學班級聯合自治會組織章程",
        category=RegulationCategory.ORDINANCE,
        content="第一條 本章程規範班聯會組織。",
        legislative_history="113 學年度第二學期第一次學生議會修訂",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
    )
    reg.revisions = [
        RegulationRevision(
            regulation_id=reg.id,
            version=1,
            change_brief="修訂",
            amended_at=dt.datetime(2025, 9, 1, tzinfo=dt.UTC),
            amended_by=uuid.uuid4(),
        )
    ]

    rendered = render_regulation_print_html(reg)

    assert "size: letter portrait;" in rendered
    assert "margin: 4mm 24mm 20mm;" in rendered
    assert "line-height: 1.5;" in rendered
    assert 'content: "第 " counter(page)' not in rendered
    assert "column-gap: 2mm;" in rendered
    assert ".chapter-row {\n      margin: 4mm 0 1mm;" in rendered
    assert ".article-row {\n      margin: 3.3mm 0;\n      break-inside: auto;" in rendered
    assert "<div>國立新竹高級中學</div><div>班級聯合自治會組織章程</div>" in rendered
    assert rendered.count("113 學年度第二學期第一次學生議會修訂") == 1
    assert "114學年度第一學期第一次學生議會修訂" not in rendered


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
        category=RegulationCategory.ORDINANCE,
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
        category=RegulationCategory.ORDINANCE,
        content="",
        org_id=uuid.uuid4(),
        created_by=uuid.uuid4(),
        workflow_status=RegulationWorkflowStatus.PUBLISHED,
    )
    reg.published_document_id = None
    result = await audit_regulation_document_consistency(FakeSession([reg]))  # type: ignore[arg-type]
    assert result["problem_count"] >= 1
    assert any(p["type"] == "published_regulation_missing_document" for p in result["problems"])
