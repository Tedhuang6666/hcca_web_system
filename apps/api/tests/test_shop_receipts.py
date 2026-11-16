"""班聯原始雙聯收據的版面與續頁回歸。"""

import re
from datetime import date, datetime
from io import BytesIO
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from pypdf import PdfReader

from api.models.school_class import SchoolClass
from api.models.shop import Order, OrderItem, Product
from api.services.shop._confirmation import _render_class_order_confirmations_pdf
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


@pytest.mark.parametrize(("count", "page_count"), [(7, 2), (8, 2), (15, 3)])
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
    assert len(pdf.pages) == 1
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
        assert "".join("".join(specs).split()) == "特殊規格" * 20 + ":1"


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
        assert {text for text, _, _ in row} == {"紀念商品00", "1", "100", "L:1"}
        assert all(
            size == pytest.approx(10 if text in {"紀念商品00", "L:1"} else 12, abs=0.01)
            for text, _, size in row
        )
        assert max(top for _, top, _ in row) - min(top for _, top, _ in row) < 3


def test_print_time_is_small_and_placed_at_the_page_upper_left():
    printed_at = datetime(2026, 10, 21, 15, 30, tzinfo=ZoneInfo("Asia/Taipei"))
    pdf = PdfReader(
        BytesIO(
            _render_class_receipt_pdf(
                "一年十五班",
                115,
                "校慶預購",
                [_order(1)],
                date(2026, 10, 21),
                printed_at,
            )
        )
    )
    text_positions = _text_positions(pdf.pages[0])
    timestamp = [item for item in text_positions if "列印時間" in item[0]]
    assert len(timestamp) == 1
    assert timestamp[0][0] == "列印時間：2026-10-21 15:30"
    assert 7 < timestamp[0][1] < 10
    assert 4 < timestamp[0][2] < 12
    assert timestamp[0][3] == pytest.approx(6.5, abs=0.01)


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
    assert text.count("L:1") == (2 if with_spec else 0)
    remarks = [
        text
        for text, x, top, _ in _text_positions(pdf.pages[0])
        if 413 < x < 574 and (159 < top < 318 or 504 < top < 664)
    ]
    assert remarks == (["L:1", "L:1"] if with_spec else [])


def test_specs_merge_across_orders_and_prices_without_changing_money():
    product = Product(id=uuid4(), name="紀念衫")
    orders = [
        Order(
            total_price=180,
            items=[
                OrderItem(
                    product=product,
                    product_id=product.id,
                    quantity=2,
                    unit_price=100,
                    selected_options=[{"group_name": "尺寸", "value": "L"}],
                )
            ],
        ),
        Order(
            total_price=480,
            items=[
                OrderItem(
                    product=product,
                    product_id=product.id,
                    quantity=4,
                    unit_price=120,
                    selected_options=[{"group_name": "尺寸", "value": "XL"}],
                )
            ],
        ),
    ]
    pdf = PdfReader(
        BytesIO(_render_class_receipt_pdf("一年一班", 115, "校慶預購", orders, date(2026, 10, 21)))
    )
    assert len(pdf.pages) == 1
    text = pdf.pages[0].extract_text()
    assert text.count("紀念衫") == 2
    assert text.count("L:2、XL:4") == 2
    assert text.count("100～120") == 2
    assert text.count("680") == 2
    assert text.count("優惠折抵") == 2
    assert text.count("660") == 2
    quantities = [
        value
        for value, x, top, _ in _text_positions(pdf.pages[0])
        if 184 < x < 231 and (159 < top < 182 or 504 < top < 528)
    ]
    assert quantities == ["6", "6"]


def test_many_specs_of_one_product_fit_one_double_copy_page():
    order = _order(20)
    product = order.items[0].product
    for index, item in enumerate(order.items):
        item.product = product
        item.product_id = order.items[0].product_id
        item.selected_options = [{"group_name": "尺寸", "value": f"S{index:02d}"}]
    pdf = _render(order)
    assert len(pdf.pages) == 1
    text = "".join(pdf.pages[0].extract_text().split())
    assert text.count("紀念商品00") == 2
    for index in range(20):
        assert text.count(f"S{index:02d}:1") == 2


def test_confirmation_many_products_keep_headers_totals_and_all_items_across_pages():
    order = _order(80)
    school_class = SchoolClass(academic_year=115, class_code="101", label="一年一班")
    pdf = PdfReader(
        BytesIO(
            _render_class_order_confirmations_pdf(
                [(school_class, [order])],
                "校慶預購",
                datetime(2026, 11, 16, tzinfo=ZoneInfo("Asia/Taipei")),
            )
        )
    )
    assert len(pdf.pages) >= 3
    text = "".join(page.extract_text() for page in pdf.pages)
    for index in range(80):
        assert text.count(f"紀念商品{index:02d}") == 1
    for page in pdf.pages:
        if "紀念商品" in page.extract_text():
            assert "品項" in page.extract_text() and "規格數量" in page.extract_text()
    final = "".join(pdf.pages[-1].extract_text().split())
    assert "總件數：80件" in final
    assert "訂單總額：8,000元" in final
    assert "班級確認人" in final


def test_variant_combinations_and_unspecified_items_are_counted_separately():
    from api.services.shop._receipts import _receipt_products, _receipt_variant_summary

    order = _order(4)
    product = order.items[0].product
    for item in order.items:
        item.product = product
        item.product_id = order.items[0].product_id
    order.items[0].selected_options = [
        {"group_name": "尺寸", "value": "L"},
        {"group_name": "顏色", "value": "黑"},
    ]
    order.items[1].selected_options = list(reversed(order.items[0].selected_options))
    order.items[2].selected_options = [
        {"group_name": "顏色", "value": "白"},
        {"group_name": "尺寸", "value": "L"},
    ]
    order.items[3].selected_options = []
    summary = _receipt_variant_summary(_receipt_products([order])[0])
    assert "尺寸=L／顏色=黑:2" in summary
    assert "尺寸=L／顏色=白:1" in summary
    assert "無規格:1" in summary
