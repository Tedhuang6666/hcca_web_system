from __future__ import annotations

import re
from io import BytesIO
from uuid import UUID

import pytest
from pypdf import PdfReader

from api.schemas.shop import OrderSummaryOut
from api.services.shop._print_reports import ReportData, ReportType, render_order_report_pdf
from api.services.shop._purchase_report import (
    ClassSheetBuyer,
    ClassSheetPage,
    ClassTotalLine,
    ClassTotalsPage,
)


@pytest.mark.parametrize(
    ("report_type", "data"),
    [
        ("classes", OrderSummaryOut(group_by="class")),
        ("people", []),
        ("class-sheet", []),
        (
            "class-totals",
            [
                ClassTotalsPage(
                    key="101",
                    class_label="高一一班",
                    academic_year=115,
                    class_code="101",
                    grade=1,
                    lines=[
                        ClassTotalLine(
                            product_id=UUID(int=1),
                            product_name="傳情卡片餅乾套組",
                            option_label="",
                            unit_price=100,
                            quantity=2,
                        )
                    ],
                )
            ],
        ),
        ("council", []),
    ],
)
def test_every_report_pdf_includes_taipei_print_time(report_type: ReportType, data: ReportData) -> None:
    pdf = render_order_report_pdf(report_type, data, "聖誕傳情")
    text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages)

    assert re.search(r"列印時間：\d{4}/\d{2}/\d{2} \d{2}:\d{2}", text)


def test_class_sheet_pdf_numbers_pages_separately_for_each_class() -> None:
    pages = [
        ClassSheetPage(
            key=class_code,
            class_label=f"{class_code} 班",
            academic_year=115,
            class_code=class_code,
            grade=1,
            buyers=[
                ClassSheetBuyer(
                    key=f"{class_code}-{index}",
                    name=f"學生{index}",
                    seat=index,
                    items=["傳情卡片餅乾套組 × 1"],
                )
                for index in range(1, 61)
            ],
        )
        for class_code in ("101", "102")
    ]

    pdf = render_order_report_pdf("class-sheet", pages, "聖誕傳情")
    page_texts = [page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages]
    markers = [
        re.search(r"(101|102)\s*第\s*(\d+)\s*/\s*(\d+)\s*頁", text)
        for text in page_texts
    ]

    assert all(markers)
    for class_code in ("101", "102"):
        class_markers = [marker for marker in markers if marker and marker.group(1) == class_code]
        page_numbers = [int(marker.group(2)) for marker in class_markers]
        totals = {int(marker.group(3)) for marker in class_markers}
        assert len(page_numbers) >= 2
        assert page_numbers == list(range(1, len(page_numbers) + 1))
        assert totals == {len(page_numbers)}
        assert all(
            "列印時間：" in page_texts[index]
            for index, marker in enumerate(markers)
            if marker and marker.group(1) == class_code
        )


def test_report_title_uses_only_topic_and_report_name() -> None:
    pdf = render_order_report_pdf("council", [], "聖誕傳情")
    text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages)

    assert "聖誕傳情班聯商品尺寸總表" in text
    assert "報表範圍" not in text
    assert "全部收款狀態" not in text


def test_class_totals_title_keeps_class_and_topic_without_filter_metadata() -> None:
    page = ClassTotalsPage(
        key="101",
        class_label="高一一班",
        academic_year=115,
        class_code="101",
        grade=1,
        lines=[
            ClassTotalLine(
                product_id=UUID(int=1),
                product_name="傳情卡片餅乾套組",
                option_label="",
                unit_price=100,
                quantity=2,
            )
        ],
    )
    pdf = render_order_report_pdf("class-totals", [page], "聖誕傳情")
    text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf)).pages)

    assert "115 學年度 1 年 1 班 （聖誕傳情）班級明細" in text
    assert "全部收款狀態" not in text
    assert re.search(r"列印時間：\d{4}/\d{2}/\d{2} \d{2}:\d{2}", text)
