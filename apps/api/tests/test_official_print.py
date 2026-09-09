"""公文 PDF 產出資源測試。"""

from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from pypdf import PdfReader

from api.services import official_print
from api.services.official_print import (
    _BUNDLED_KAI_FONT,
    _BUNDLED_LISHU_FONT,
    _BUNDLED_TITLE_FONT,
    _BUNDLED_XINGSHU_FONT,
    _FALLBACK_KAI_FONT,
    _decree_issuer_title,
    _final_signature_html,
    _font_faces,
    _full_org_name,
    _official_document_title,
    render_document_print_html,
    render_print_pdf,
)


class _OrgSession:
    def __init__(self, *orgs: SimpleNamespace) -> None:
        self.orgs = {org.id: org for org in orgs}

    async def get(self, _model: object, org_id: object) -> SimpleNamespace | None:
        return self.orgs.get(org_id)


def test_official_print_uses_distinct_bundled_body_and_signature_fonts() -> None:
    """正文與末署應使用兩個不同的專案內字型，不依賴主機字型。"""
    css = _font_faces()

    assert _BUNDLED_KAI_FONT in css
    assert _BUNDLED_LISHU_FONT in css
    assert quote(_BUNDLED_TITLE_FONT) in css
    assert quote(_BUNDLED_XINGSHU_FONT) in css
    assert _FALLBACK_KAI_FONT not in css
    assert 'font-family: "OfficialKai"' in css
    assert 'font-family: "OfficialLishu"' in css
    assert 'font-family: "OfficialTitle"' in css
    assert 'font-family: "OfficialXingshu"' in css
    assert "file://" in css


def test_official_document_title_uses_formal_issuer_and_document_type() -> None:
    issuer = "國立新竹高級中學班聯會設計部"

    assert (
        _official_document_title(
            issuer,
            "國立新竹高級中學設計部籌備會議開會通知單",
            "開會通知單",
            "設計部",
        )
        == "國立新竹高級中學班聯會設計部開會通知單"
    )


def test_official_document_title_preserves_explicit_full_org_title() -> None:
    assert (
        _official_document_title(
            "國立新竹高級中學班聯會",
            "國立新竹高級中學學生會咨",
            "咨",
            "班級聯合自治會",
        )
        == "國立新竹高級中學學生會咨"
    )


def test_official_print_supports_container_source_layout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(official_print, "__file__", "/app/src/api/services/official_print.py")

    candidates = official_print._bundled_font_candidates(_BUNDLED_KAI_FONT)

    assert candidates[0] == Path("/app/fonts") / _BUNDLED_KAI_FONT


def test_render_print_pdf_embeds_bundled_body_and_signature_fonts() -> None:
    pdf = render_print_pdf(
        f"<html><head><style>{_font_faces()}</style></head>"
        '<body><span style="font-family: OfficialKai">國立新竹高級中學公文測試</span>'
        '<span style="font-family: OfficialLishu">主席黃丞廷</span>'
        '<span style="font-family: OfficialTitle">議長</span>'
        '<span style="font-family: OfficialXingshu">黃丞廷</span></body></html>'
    )
    reader = PdfReader(BytesIO(pdf))
    embedded_fonts = []
    base_fonts = []
    for page in reader.pages:
        resources = page.get("/Resources", {})
        for font_ref in (resources.get("/Font", {}) or {}).values():
            font = font_ref.get_object()
            base_fonts.append(str(font.get("/BaseFont", "")))
            for descendant_ref in font.get("/DescendantFonts", []):
                descendant = descendant_ref.get_object()
                descriptor_ref = descendant.get("/FontDescriptor")
                if descriptor_ref is not None:
                    embedded_fonts.append(descriptor_ref.get_object())

    assert any(
        "/FontFile2" in descriptor or "/FontFile3" in descriptor for descriptor in embedded_fonts
    )
    assert any("OfficialKai" in font_name for font_name in base_fonts)
    assert any("OfficialLishu" in font_name for font_name in base_fonts)
    assert any("OfficialTitle" in font_name for font_name in base_fonts)
    assert any("OfficialXingshu" in font_name for font_name in base_fonts)


@pytest.mark.asyncio
async def test_full_org_name_keeps_selected_official_name_without_spaces() -> None:
    council = SimpleNamespace(
        id="council",
        name="國立新竹高級中學班級聯合自治會",
        parent_id=None,
    )
    student_union = SimpleNamespace(
        id="student-union",
        name="學生會",
        parent_id="council",
    )
    design = SimpleNamespace(id="design", name="設計部", parent_id="student-union")
    session = _OrgSession(council, student_union, design)

    assert (
        await _full_org_name(
            session,
            SimpleNamespace(issuer_full_name=None, org=design),
        )
        == "國立新竹高級中學班聯會設計部"
    )
    assert (
        await _full_org_name(
            session,
            SimpleNamespace(
                issuer_full_name="新竹高中學生議會 秘書處",
                org=SimpleNamespace(name="秘書處"),
            ),
        )
        == "國立新竹高級中學學生議會秘書處"
    )


@pytest.mark.asyncio
async def test_decree_signature_falls_back_to_chair_title() -> None:
    doc = SimpleNamespace(approvals=[], handler_name="黃丞廷", handler_unit="設計部")

    signature = await _final_signature_html(SimpleNamespace(), doc, fallback_title="主席")

    assert "主席" in signature
    assert "黃丞廷" in signature
    assert "設計部" not in signature


@pytest.mark.asyncio
async def test_final_signature_uses_approver_position_on_decision_date(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    decision_at = official_print.dt.datetime(2026, 8, 31, 18, tzinfo=official_print.dt.UTC)
    approver = SimpleNamespace(id="approver", display_name="王小明")
    doc = SimpleNamespace(
        org_id="design",
        approvals=[
            SimpleNamespace(
                status="approved",
                step_order=1,
                approver=approver,
                delegate=None,
                is_acting=False,
                decided_at=decision_at,
            )
        ],
    )
    seen_dates: list[official_print.dt.date | None] = []

    async def fake_position_title(
        _session: object,
        *,
        user_id: object,
        org_id: object,
        on_date: official_print.dt.date | None = None,
    ) -> str:
        assert user_id == approver.id
        assert org_id == doc.org_id
        seen_dates.append(on_date)
        return "設計長"

    monkeypatch.setattr(official_print, "_position_title", fake_position_title)

    signature = await _final_signature_html(SimpleNamespace(), doc)

    assert "設計長" in signature
    assert seen_dates == [official_print.dt.date(2026, 9, 1)]


def test_decree_title_supports_different_authorities() -> None:
    issuer = "國立新竹高級中學班聯會"

    assert _decree_issuer_title(SimpleNamespace(title="議長令"), issuer) == "議長"
    assert _decree_issuer_title(SimpleNamespace(title=f"{issuer}總召令"), issuer) == "總召"
    assert _decree_issuer_title(SimpleNamespace(title="法規發布令"), issuer) == "主席"


@pytest.mark.asyncio
async def test_decree_print_uses_full_school_heading_and_government_layout() -> None:
    council = SimpleNamespace(id="council", name="班級聯合自治會", parent_id=None)
    doc = SimpleNamespace(
        category="decree",
        issuer_full_name=None,
        org=council,
        org_id="council",
        title="議長令",
        urgency="normal",
        classification="normal",
        recipients=[],
        attachments=[],
        issued_at=None,
        completed_at=None,
        created_at=None,
        serial_number="嶺班令字第1150000001號",
        file_number=None,
        retention_period=None,
        approvals=[],
        handler_name="黃丞廷",
        handler_unit=None,
        handler_email=None,
        subject=None,
        content=None,
        action_required=None,
        doc_description="茲發布本令。",
    )

    rendered = await render_document_print_html(_OrgSession(council), doc)

    assert "國立新竹高級中學班聯會議長令</header>" in rendered
    assert '<span class="signature-title">議長</span>' in rendered
    assert '<span class="signature-name">黃丞廷</span>' in rendered
    assert "margin: 25mm;" in rendered
    assert 'font-family: "Times New Roman","OfficialKai","標楷體","DFKai-SB",serif;' in rendered


@pytest.mark.asyncio
async def test_consultation_print_uses_two_paragraph_body_and_closing() -> None:
    council = SimpleNamespace(id="council", name="班級聯合自治會", parent_id=None)
    doc = SimpleNamespace(
        category="consultation",
        issuer_full_name=None,
        org=council,
        org_id="council",
        title="國立新竹高級中學學生會咨",
        urgency="normal",
        classification="normal",
        declassification_condition="none",
        recipients=[
            SimpleNamespace(recipient_type="main", name="立法院"),
            SimpleNamespace(recipient_type="copy", name="行政院"),
        ],
        attachments=[],
        issued_at=None,
        completed_at=None,
        created_at=None,
        serial_number="嶺咨字第1150000001號",
        file_number=None,
        retention_period=None,
        classification_number=None,
        approvals=[],
        handler_name="○○○",
        handler_unit="總統",
        handler_email=None,
        handler_phone=None,
        subject="茲依據中華民國憲法增修條文第○條第○項規定，提名○○○為第○屆○○院委員並為院長，咨請貴院行使同意權。",
        content=None,
        doc_description=(
            "一、依本會組織章程第九條第三款規定，主席具提名並咨請學生議會同意任命行政幹部之職權。\n"
            "二、為健全本會行政組織及推動各項會務，爰提名下列人員擔任第40屆班級聯合自治會行政幹部。\n"
            "三、幹部提名名冊如附件。"
        ),
        action_required=None,
    )

    rendered = await render_document_print_html(_OrgSession(council), doc)
    pdf = render_print_pdf(rendered)

    assert "國立新竹高級中學學生會咨</header>" in rendered
    assert "國立新竹高級中學班聯會咨</header>" not in rendered
    assert 'class="consultation-content"' in rendered
    assert '<section class="consultation-recipient">受文者：立法院</section>' in rendered
    assert '<div class="subject-label">主旨：</div>' in rendered
    assert "茲依據中華民國憲法增修條文" in rendered
    assert '<div class="doc-section-label">說明：</div>' in rendered
    assert '<span class="hanging-prefix">一、</span>' in rendered
    assert 'class="consultation-closing">此咨</div>' in rendered
    assert 'class="consultation-final-recipient">立法院</div>' in rendered
    assert "<div>正本：立法院</div>" in rendered
    assert "<div>副本：行政院</div>" in rendered
    assert '<span class="signature-title">總統</span>' in rendered
    assert "辦法或事項：" not in rendered
    assert len(PdfReader(BytesIO(pdf)).pages) == 1

    doc.handler_unit = None
    fallback_rendered = await render_document_print_html(_OrgSession(council), doc)
    assert '<span class="signature-title">主席</span>' in fallback_rendered


@pytest.mark.asyncio
async def test_meeting_notice_seal_stays_on_one_page_with_handwritten_font() -> None:
    council = SimpleNamespace(id="council", name="班級聯合自治會", parent_id=None)
    design = SimpleNamespace(id="design", name="設計部", parent_id="council")
    doc = SimpleNamespace(
        category="meeting_notice",
        issuer_full_name=None,
        org=design,
        org_id="design",
        title="國立新竹高級中學設計部籌備會議開會通知單",
        urgency="normal",
        classification="normal",
        declassification_condition="none",
        recipients=[],
        attachments=[],
        issued_at=None,
        completed_at=None,
        created_at=None,
        serial_number="嶺班議字第1150000001號",
        file_number=None,
        retention_period=None,
        approvals=[],
        handler_name="黃丞廷",
        handler_unit="設計部",
        handler_email=None,
        subject=None,
        content=None,
        action_required="請準時出席。",
        doc_description="一、主席致詞。\n二、討論籌備事項。",
        meeting_purpose="設計部籌備會議",
        meeting_time=None,
        meeting_location="國立新竹高級中學行政大樓會議室",
        meeting_chairperson="黃丞廷",
    )

    rendered = await render_document_print_html(_OrgSession(council, design), doc)
    pdf = render_print_pdf(rendered)

    assert "國立新竹高級中學班聯會設計部開會通知單</header>" in rendered
    assert 'font-family: "OfficialLishu"' in rendered
    seal = rendered.split('<section class="meeting-seal"', maxsplit=1)[1].split(
        "</section>", maxsplit=1
    )[0]
    assert "國立新竹高級中學班聯會設計部" in seal
    assert "黃丞廷" not in seal
    assert 'style="font-size:29.3pt"' in rendered
    assert "text-align: center;" in rendered
    assert "white-space: nowrap" in rendered
    assert len(PdfReader(BytesIO(pdf)).pages) == 1


@pytest.mark.asyncio
async def test_document_print_flows_long_description_on_first_page() -> None:
    """長篇說明應從第一頁的剩餘空間開始排版，而非整段移至下一頁。"""
    council = SimpleNamespace(id="council", name="班級聯合自治會", parent_id=None)
    description = "\n".join(
        (
            "一、依本會學生陳情系統學生第1150006號陳情案辦理。",
            "二、據學生反映，本校目前提供 HyRead、Hami Book 及國立公共資訊圖書館等電子書資源，"
            "惟各平台對不同廠牌及作業系統之電子紙閱讀器支援程度不一。其中，HyRead 主要支援"
            "自有閱讀器及相關服務；Hami Book得於部分採用 Android 系統之開放式電子紙閱讀器"
            "使用；國立公共資訊圖書館相關電子書服務亦得依其平台及裝置支援情形使用。",
            "三、另有學生使用 Kobo 等電子紙閱讀器，其圖書館借閱功能主要透過 OverDrive 相關服務"
            "與合作圖書館館藏整合，惟目前無法透過本校圖書館使用該項借閱服務，致部分電子紙"
            "閱讀器使用者無法直接利用本校電子書館藏。",
            "四、電子紙閱讀器具有便於攜帶大量電子書籍、降低一般行動裝置其他應用程式干擾等特性，"
            "對於鼓勵學生利用電子館藏及培養閱讀習慣具有一定助益。隨電子閱讀設備日益普及，"
            "電子館藏對不同閱讀裝置之相容性亦值得納入圖書館數位閱讀服務之規劃。",
            "五、爰建請貴館評估本校導入 OverDrive 電子書借閱服務之可行性，包括申請或合作方式、"
            "授權及採購費用、館藏資源、帳號驗證方式、既有電子書平台之整合情形，以及實際可"
            "支援之電子紙閱讀器等事項。",
            "六、如現階段因經費、授權、系統或其他因素尚無法導入，亦建請貴館提供相關評估結果或"
            "現有替代使用方式，以利本會向陳情學生說明。",
        )
    )
    doc = SimpleNamespace(
        category="letter",
        issuer_full_name=None,
        org=council,
        org_id="council",
        title="國立新竹高級中學班聯會函",
        urgency="normal",
        classification="normal",
        declassification_condition="none",
        recipients=[SimpleNamespace(recipient_type="main", name="圖書館")],
        attachments=[],
        issued_at=None,
        completed_at=None,
        created_at=None,
        serial_number="嶺班學陳字第1150000003號",
        approvals=[],
        handler_name="黃丞廷",
        handler_unit="主席",
        handler_email="ted981026@gmail.com",
        subject="有關學生建議本校圖書館評估導入電子書借閱服務一案，請查照。",
        content=None,
        doc_description=description,
        action_required="敬請圖書館評估相關方案，並函復本會。",
        visibility_level="private",
    )

    rendered = await render_document_print_html(_OrgSession(council), doc)
    pdf = render_print_pdf(rendered)

    reader = PdfReader(BytesIO(pdf))
    assert "本會學生陳情" in reader.pages[0].extract_text()
    assert '<section class="document-closing">' in rendered
    assert len(reader.pages) == 2
    assert "主席" in reader.pages[1].extract_text()


@pytest.mark.asyncio
async def test_public_announcement_print_keeps_chief_signature() -> None:
    council = SimpleNamespace(id="council", name="班級聯合自治會", parent_id=None)
    doc = SimpleNamespace(
        category="announcement",
        issuer_full_name=None,
        org=council,
        org_id="council",
        title="國立新竹高級中學學生代表團公告",
        urgency="priority",
        classification="normal",
        declassification_condition="none",
        recipients=[],
        attachments=[],
        issued_at=None,
        completed_at=None,
        created_at=None,
        serial_number="嶺代綜字第 1150000001 號",
        approvals=[],
        handler_name="黃丞廷",
        handler_unit="主席",
        handler_email=None,
        subject="公告第二屆學生代表暨備取學生代表名單。",
        basis="學生代表法第五十條。",
        content=None,
        doc_description="一、第二屆學生代表業經選出，自即日起就任。",
        action_required=None,
        visibility_level="publicly_open",
    )

    rendered = await render_document_print_html(_OrgSession(council), doc)
    reader = PdfReader(BytesIO(render_print_pdf(rendered)))

    assert '<span class="signature-title">主席</span>' in rendered
    assert '<span class="signature-name">黃丞廷</span>' in rendered
    assert "主席" in "".join(page.extract_text() for page in reader.pages)
    assert "黃丞廷" in "".join(page.extract_text() for page in reader.pages)
