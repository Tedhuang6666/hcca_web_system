"""公文 PDF 產出資源測試。"""

from io import BytesIO
from types import SimpleNamespace

import pytest
from pypdf import PdfReader

from api.services.official_print import (
    _BUNDLED_KAI_FONT,
    _decree_issuer_title,
    _final_signature_html,
    _font_faces,
    _full_org_name,
    render_print_pdf,
)


def test_official_print_uses_bundled_kai_font() -> None:
    """正式映像與本機測試都應使用專案內固定的楷體，不依賴主機字型。"""
    css = _font_faces()

    assert _BUNDLED_KAI_FONT in css
    assert 'font-family: "OfficialKai"' in css
    assert 'font-family: "OfficialHand"' in css
    assert "file://" in css


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
    doc = SimpleNamespace(
        issuer_full_name=None,
        org=SimpleNamespace(name="班聯會 設計部"),
    )

    assert await _full_org_name(SimpleNamespace(), doc) == "班聯會設計部"
    assert (
        await _full_org_name(
            SimpleNamespace(),
            SimpleNamespace(
                issuer_full_name="新竹高中學生議會 秘書處",
                org=SimpleNamespace(name="秘書處"),
            ),
        )
        == "新竹高中學生議會秘書處"
    )


@pytest.mark.asyncio
async def test_decree_signature_falls_back_to_chair_title() -> None:
    doc = SimpleNamespace(approvals=[], handler_name="黃丞廷", handler_unit=None)

    signature = await _final_signature_html(SimpleNamespace(), doc, fallback_title="主席")

    assert "主席" in signature
    assert "黃丞廷" in signature


def test_decree_title_supports_different_authorities() -> None:
    assert _decree_issuer_title(SimpleNamespace(issuer_full_name="主席", title="議長令")) == "議長"
    assert (
        _decree_issuer_title(SimpleNamespace(issuer_full_name="總召", title="法規發布令")) == "總召"
    )
