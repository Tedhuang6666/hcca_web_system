"""班聯原始雙聯收據的版面與續頁回歸。"""

import re
from datetime import date
from io import BytesIO
from uuid import uuid4

import pytest
from pypdf import PdfReader

from api.models.shop import Order, OrderItem, Product
from api.services.shop._receipts import _RECEIPT_TEMPLATE, _render_class_receipt_pdf


def _order(count: int, *, name: str = "紀念商品", total: int | None = None) -> Order:
    return Order(
        total_price=total if total is not None else count * 100,
        items=[
            OrderItem(
                product_id=uuid4(),
                product=Product(name=f"{name}{index:02d}"),
                quantity=1,
                unit_price=100,
                selected_options=[{"group_name": "尺寸", "value": "L"}],
            )
            for index in range(count)
        ],
    )


def _render(order: Order) -> PdfReader:
    return PdfReader(
        BytesIO(
            _render_class_receipt_pdf("一年十五班", 115, "校慶預購", [order], date(2026, 10, 21))
        )
    )


def _text_positions(page) -> list[tuple[str, float, float, float]]:
    positions = []

    def visit(text, cm, tm, _font, size):
        if text.strip():
            x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
            top = 792 - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
            positions.append((text.strip(), x, top, size * abs(cm[0])))

    page.extract_text(visitor_text=visit)
    return positions


@pytest.mark.parametrize(("count", "page_count"), [(7, 2), (8, 2), (15, 4)])
def test_receipt_reuses_original_borders_and_logo_on_every_double_copy_page(count, page_count):
    pdf = _render(_order(count))
    template = PdfReader(_RECEIPT_TEMPLATE).pages[0]
    template_rectangles = [a for a, op in template.get_contents().operations if op == b"re"]
    template_images = {image.data for image in template.images}
    assert len(pdf.pages) == page_count
    for page in pdf.pages:
        assert tuple(page.mediabox) == (0, 0, 612, 792)
        rectangles = [a for a, op in page.get_contents().operations if op == b"re"]
        assert rectangles[: len(template_rectangles)] == template_rectangles
        assert {image.data for image in page.images} == template_images
        text = page.extract_text()
        assert text.count("收執聯") == 1 and text.count("存根聯") == 1
        assert "繳款人簽名" not in text and "班聯收款人簽名" not in text
        for _, x, top, _ in _text_positions(page):
            assert not (410 < x < 576 and (274 < top < 376 or 620 < top < 722))
    text = "".join(page.extract_text() for page in pdf.pages)
    for index in range(count):
        assert text.count(f"紀念商品{index:02d}") == 2


def test_long_names_and_specs_continue_in_empty_rows_without_losing_text():
    order = _order(1, name="長品名" * 25)
    order.items[0].selected_options = [{"group_name": "規格", "value": "特殊規格" * 20}]
    pdf = _render(order)
    assert len(pdf.pages) == 2
    for offset in (0, 345.77):
        names = []
        specs = []
        for page in pdf.pages:
            for text, x, top, _ in _text_positions(page):
                if 159 < top - offset < 318:
                    if 37 < x < 179:
                        names.append(text)
                    elif 413 < x < 574:
                        specs.append(text)
        assert "".join(names) == "長品名" * 25 + "00"
        assert "".join(specs) == "校慶預購規格：" + "特殊規格" * 20


def test_discount_on_an_extra_page_keeps_the_whole_receipt_total():
    pdf = _render(_order(7, total=670))
    assert len(pdf.pages) == 2
    assert "優惠折抵" not in pdf.pages[0].extract_text()
    assert pdf.pages[1].extract_text().count("優惠折抵") == 2
    for page in pdf.pages:
        assert page.extract_text().count("670") == 2
        assert "總額為整份收據合計" in page.extract_text()


def test_amount_above_six_digits_is_not_truncated_to_the_template_slots():
    order = _order(1, total=1_200_000)
    order.items[0].unit_price = 1_200_000
    pdf = _render(order)
    assert pdf.pages[0].extract_text().count("新台幣 1,200,000 元整") == 2
    assert "/Author" not in pdf.metadata


@pytest.mark.parametrize(
    "class_label",
    ["一年一班", "115學年度1年1班", "115 學年度 1 年 1 班", "一年一班（115學年度）"],
)
def test_buyer_includes_the_academic_year_once_per_copy(class_label):
    pdf = PdfReader(
        BytesIO(
            _render_class_receipt_pdf(class_label, 115, "校慶預購", [_order(1)], date(2026, 10, 21))
        )
    )
    text = pdf.pages[0].extract_text()
    assert len(re.findall(r"115\s*學年度", text)) == 2
    assert text.count(class_label) == 2


def test_filled_fields_match_the_template_font_size_and_baselines():
    positions = _text_positions(_render(_order(1)).pages[0])
    for offset in (0, 345.77):
        copy = [(text, x, top - offset, size) for text, x, top, size in positions]
        for value, x_min, x_max, baseline in [
            ("一年十五班（115 學年度）", 84, 86, 107.54),
            ("115", 120, 144, 127.22),
            ("10", 162, 180, 127.22),
            ("21", 198, 216, 127.22),
            ("100", 306, 406, 336.17),
            ("壹", 235, 245, 365.93),
        ]:
            matches = [
                (top, size)
                for text, x, top, size in copy
                if text == value and x_min < x < x_max and abs(top - baseline) < 0.1
            ]
            assert matches == [(pytest.approx(baseline, abs=0.05), pytest.approx(12))]
        row = [(text, top, size) for text, _, top, size in copy if 159 < top < 182]
        assert {text for text, _, _ in row} == {"紀念商品00", "1", "100", "校慶預購"}
        assert all(size == pytest.approx(12) for _, _, size in row)
        assert all(top == pytest.approx(row[0][1], abs=0.05) for _, top, _ in row)


def test_rows_without_remarks_use_all_seven_left_cells_and_keep_stamp_area_blank():
    order = _order(7)
    for item in order.items:
        item.selected_options = []
    pdf = _render(order)
    assert len(pdf.pages) == 1
    assert pdf.pages[0].extract_text().count("紀念商品06") == 2
    for _, x, top, _ in _text_positions(pdf.pages[0]):
        assert not (410 < x < 576 and (274 < top < 376 or 620 < top < 722))


@pytest.mark.parametrize("with_spec", [False, True])
def test_general_goods_note_is_omitted_and_selected_spec_is_preserved(with_spec):
    order = _order(1)
    if not with_spec:
        order.items[0].selected_options = []
    pdf = PdfReader(
        BytesIO(_render_class_receipt_pdf("一年一班", 115, "一般商品", [order], date(2026, 10, 21)))
    )
    text = pdf.pages[0].extract_text()
    assert "一般商品" not in text
    assert text.count("尺寸：L") == (2 if with_spec else 0)
    remarks = [
        text
        for text, x, top, _ in _text_positions(pdf.pages[0])
        if 413 < x < 574 and (159 < top < 318 or 504 < top < 664)
    ]
    assert remarks == (["尺寸：L", "尺寸：L"] if with_spec else [])
