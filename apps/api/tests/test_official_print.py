"""公文 PDF 產出資源測試。"""

from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from pypdf import PdfReader

from api.services import official_print
from api.services.official_print import (
    _BUNDLED_KAI_FONT,
    _decree_issuer_title,
    _final_signature_html,
    _font_faces,
    _full_org_name,
    render_document_print_html,
    render_print_pdf,
)


class _OrgSession:
    def __init__(self, *orgs: SimpleNamespace) -> None:
        self.orgs = {org.id: org for org in orgs}

    async def get(self, _model: object, org_id: object) -> SimpleNamespace | None:
        return self.orgs.get(org_id)


def test_official_print_uses_bundled_kai_font() -> None:
    """正式映像與本機測試都應使用專案內固定的楷體，不依賴主機字型。"""
    css = _font_faces()

    assert _BUNDLED_KAI_FONT in css
    assert 'font-family: "OfficialKai"' in css
    assert 'font-family: "OfficialHand"' in css
    assert "file://" in css


def test_official_print_supports_container_source_layout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(official_print, "__file__", "/app/src/api/services/official_print.py")

    candidates = official_print._bundled_font_candidates(_BUNDLED_KAI_FONT)

    assert candidates[0] == Path("/app/fonts") / _BUNDLED_KAI_FONT


def test_render_print_pdf_embeds_bundled_kai_font() -> None:
    pdf = render_print_pdf(
        f"<html><head><style>{_font_faces()}</style></head>"
        '<body style="font-family: OfficialKai">國立新竹高級中學公文測試</body></html>'
    )
    reader = PdfReader(BytesIO(pdf))
    embedded_fonts = []
    for page in reader.pages:
        resources = page.get("/Resources", {})
        for font_ref in (resources.get("/Font", {}) or {}).values():
            font = font_ref.get_object()
            for descendant_ref in font.get("/DescendantFonts", []):
                descendant = descendant_ref.get_object()
                descriptor_ref = descendant.get("/FontDescriptor")
                if descriptor_ref is not None:
                    embedded_fonts.append(descriptor_ref.get_object())

    assert any(
        "/FontFile2" in descriptor or "/FontFile3" in descriptor for descriptor in embedded_fonts
    )


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
