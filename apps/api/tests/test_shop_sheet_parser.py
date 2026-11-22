"""以合成填答驗證規格解析，不讀取真實表單個資。"""

import pytest

from api.services.shop._sheet_parser import AnswerNeedsReview, parse_answer, product_label

SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"]


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("L 2件、XL×1", {"L": 2, "XL": 1}),
        ("Ｌ：２件；ＸＬ＊１", {"L": 2, "XL": 1}),
        ("M一件，L兩件", {"M": 1, "L": 2}),
        ("XXL x 2 / XXXL 1", {"2XL": 2, "3XL": 1}),
        ("2XL", {"2XL": 1}),
        ("3XL", {"3XL": 1}),
        ("2XL 3XL", {"2XL": 1, "3XL": 1}),
        ("2XL 3件", {"2XL": 3}),
        ("兩件L", {"L": 2}),
        ("2件 XL", {"XL": 2}),
        ("S/M/L各一件", {"S": 1, "M": 1, "L": 1}),
        ("尺寸L號2件，M一件，共3件", {"L": 2, "M": 1}),
        ("L1、L2", {"L": 3}),
        ("L(2件)，XL（一件）", {"L": 2, "XL": 1}),
        ("大號兩件，中號一件", {"L": 2, "M": 1}),
        ("L2 M", {"L": 2, "M": 1}),
        ("XL", {"XL": 1}),
        ("無", {}),
    ],
)
def test_parse_size_quantity_variations(answer, expected):
    assert {item.value: item.quantity for item in parse_answer(answer, SIZES)} == expected


@pytest.mark.parametrize(
    "answer",
    [
        "2",
        "L或XL",
        "L2件共3件",
        "M-1",
        "M1.5",
        "M0",
        "M101",
        "5XL1",
        "5XL",
        "L2XL1",
        "L2M1",
        "LXL",
        "L2件，顏色再說",
        "L2 M1各2件",
        "XLARGE",
        "大概兩件",
    ],
)
def test_ambiguous_or_invalid_sizes_need_review(answer):
    with pytest.raises(AnswerNeedsReview):
        parse_answer(answer, SIZES)


@pytest.mark.parametrize(
    ("answer", "quantity"),
    [("２個", 2), ("兩條", 2), ("十一件", 11), ("二十三", 23), ("一百", 100)],
)
def test_parse_unsized_quantity(answer, quantity):
    assert parse_answer(answer, [])[0].quantity == quantity


@pytest.mark.parametrize("answer", ["要", "1.5", "-1", "1000", "兩件再看", "1,2", "1/2"])
def test_unsized_answer_must_be_an_unambiguous_positive_integer(answer):
    with pytest.raises(AnswerNeedsReview):
        parse_answer(answer, [])


def test_non_clothing_options_match_only_existing_values():
    assert [
        (item.value, item.quantity) for item in parse_answer("42碼兩雙", ["40", "42", "44"])
    ] == [("42", 2)]
    with pytest.raises(AnswerNeedsReview):
        parse_answer("44", ["40", "42"])
    assert product_label("風衣外套 NT.650 (尺寸S.M.L.XL.2XL.3XL)") == "風衣外套"


@pytest.mark.parametrize(
    ("answer", "options", "expected"),
    [
        ("買1件", [], {None: 1}),
        ("購買兩把", [], {None: 2}),
        ("XL買1件", SIZES, {"XL": 1}),
        ("買XL1件", SIZES, {"XL": 1}),
        ("訂購 L兩件", SIZES, {"L": 2}),
        ("XL買1件、L購買兩件", SIZES, {"XL": 1, "L": 2}),
        ("預購XXL買兩件，共2件", SIZES, {"2XL": 2}),
        ("買一送一2個", ["買一送一"], {"買一送一": 2}),
    ],
)
def test_purchase_words_preserve_explicit_quantity_and_size(answer, options, expected):
    assert {item.value: item.quantity for item in parse_answer(answer, options)} == expected


@pytest.mark.parametrize(
    ("answer", "options"),
    [
        ("買-1件", []),
        ("買1.5件", []),
        ("買101件", []),
        ("買1件再看看", []),
        ("不買1件", []),
        ("XL買1件或2件", SIZES),
        ("XL買1件，共2件", SIZES),
        ("買5XL1件", SIZES),
    ],
)
def test_purchase_words_do_not_hide_ambiguous_or_invalid_answers(answer, options):
    with pytest.raises(AnswerNeedsReview):
        parse_answer(answer, options)
