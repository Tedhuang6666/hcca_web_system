"""班聯原始雙聯收據的版面與續頁回歸。"""

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


@pytest.mark.parametrize("count", [7, 8, 15])
def test_receipt_reuses_original_borders_and_logo_on_every_double_copy_page(count):
    pdf = _render(_order(count))
    template = PdfReader(_RECEIPT_TEMPLATE).pages[0]
    template_rectangles = [a for a, op in template.get_contents().operations if op == b"re"]
    template_images = {image.data for image in template.images}
    assert len(pdf.pages) == (count + 6) // 7
    for page in pdf.pages:
        assert tuple(page.mediabox) == (0, 0, 612, 792)
        rectangles = [a for a, op in page.get_contents().operations if op == b"re"]
        assert rectangles[: len(template_rectangles)] == template_rectangles
        assert {image.data for image in page.images} == template_images
        text = page.extract_text()
        assert text.count("收執聯") == 1 and text.count("存根聯") == 1
        assert text.count("繳款人簽名") == 2 and text.count("班聯收款人簽名") == 2
    text = "".join(page.extract_text() for page in pdf.pages)
    for index in range(count):
        assert text.count(f"紀念商品{index:02d}") == 2


def test_long_names_and_specs_continue_in_empty_rows_without_losing_text():
    order = _order(1, name="長品名" * 25)
    order.items[0].selected_options = [{"group_name": "規格", "value": "特殊規格" * 20}]
    pdf = _render(order)
    assert len(pdf.pages) == 1
    names = []
    specs = []

    def visit(text, cm, tm, _font, _size):
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        top = 792 - (tm[4] * cm[1] + tm[5] * cm[3] + cm[5])
        if 159 < top < 318 or 504 < top < 664:
            if 37 < x < 179:
                names.append(text)
            elif 413 < x < 574:
                specs.append(text)

    pdf.pages[0].extract_text(visitor_text=visit)
    assert "".join(names).replace("\n", "").count("長品名" * 25 + "00") == 2
    assert "".join(specs).replace("\n", "").count("規格：" + "特殊規格" * 20) == 2


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
