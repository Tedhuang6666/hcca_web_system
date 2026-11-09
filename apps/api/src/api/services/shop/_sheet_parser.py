"""保守、可解釋的自由填答解析；不丟棄未知字元，也不猜未填的規格。"""

import re
import unicodedata
from collections import Counter
from dataclasses import dataclass


class AnswerNeedsReview(ValueError):
    """填答不完整或有多種解釋，需由人確認。"""


@dataclass(frozen=True)
class ParsedVariant:
    value: str | None
    quantity: int


def normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).strip().upper()


def normalize_size(value: str) -> str:
    result = re.sub(r"\s+", "", normalize(value))
    return {"XXS": "2XS", "XXL": "2XL", "XXXL": "3XL", "XXXXL": "4XL"}.get(result, result)


_DIGITS = {char: value for value, char in enumerate("零一二三四五六七八九")}
_DIGITS.update({"兩": 2, "〇": 0})
_NUMBER = r"(?:[0-9]+|[零〇一二兩三四五六七八九十百]+)"
_UNIT = r"(?:件|個|條|把|頂|枚|組|雙|份|本|袋|入|套|張)"
_EMPTY = {"", "0", "無", "沒有", "不要", "不需要", "不訂購", "否", "NO", "N/A", "-", "—"}


def _quantity(value: str) -> int:
    if value.isascii() and value.isdigit():
        quantity = int(value)
    elif len(value) == 1 and value in _DIGITS:
        quantity = _DIGITS[value]
    elif re.fullmatch(r"[一二兩三四五六七八九]?十[一二三四五六七八九]?", value):
        tens, ones = value.split("十")
        quantity = _DIGITS.get(tens, 1) * 10 + _DIGITS.get(ones, 0)
    elif value == "一百":
        quantity = 100
    else:
        raise AnswerNeedsReview("數量無法辨識")
    if not 1 <= quantity <= 100:
        raise AnswerNeedsReview("每個規格的數量需介於 1 至 100")
    return quantity


def parse_answer(answer: str, option_values: list[str]) -> list[ParsedVariant]:
    text = normalize(answer)
    if text in _EMPTY:
        return []
    if len(text) > 2000:
        raise AnswerNeedsReview("填答過長，請簡化為規格與數量")
    if not option_values:
        match = re.fullmatch(rf"(?:數量\s*[:：]?\s*)?({_NUMBER})\s*{_UNIT}?", text)
        if match is None:
            raise AnswerNeedsReview("請填寫明確數量")
        return [ParsedVariant(None, _quantity(match[1]))]

    by_size: dict[str, str] = {}
    for value in option_values:
        key = normalize_size(value)
        if key in by_size:
            raise AnswerNeedsReview("系統規格有重複別名，請管理者確認")
        by_size[key] = value
    # 常見 X 系列別名僅在商品存在對應選項時接受。
    aliases = {key: key for key in by_size}
    for alias in ("XXS", "XXL", "XXXL", "XXXXL"):
        if normalize_size(alias) in by_size:
            aliases[alias] = normalize_size(alias)
    for alias, canonical in {"小": "S", "中": "M", "大": "L", "加大": "XL", "特大": "XL"}.items():
        if canonical in by_size:
            aliases[alias] = canonical
    sizes = "|".join(re.escape(key) for key in sorted(aliases, key=len, reverse=True))
    size = rf"(?:{sizes})(?:\s*(?:號|碼))?"
    # 先比對規格+數量，避免 2XL 被切成數量 2 和 XL。
    pattern = re.compile(
        rf"(?P<after_size>{size})\s*(?:[X×*:=]\s*)?(?P<after_n>{_NUMBER})(?![0-9A-Z])\s*{_UNIT}?"
        rf"|(?![0-9]+X+[LS])(?!(?:{sizes})(?![A-Z0-9]))(?P<before_n>{_NUMBER})\s*{_UNIT}?\s*"
        rf"(?:[×*]\s*|X\s+)?(?P<before_size>{size})"
        rf"|(?P<single>{size})"
    )
    # 括號、各與總數只有在語法明確時去除／驗算。
    text = re.sub(r"尺寸|尺碼|SIZE", "", text)
    text = re.sub(rf"\(\s*({_NUMBER})\s*({_UNIT})?\s*\)", r"\1\2", text)
    total_match = re.search(rf"(?:共|合計|總共)\s*({_NUMBER})\s*{_UNIT}?\s*$", text)
    expected_total = _quantity(total_match[1]) if total_match else None
    if total_match:
        text = text[: total_match.start()]
    each = bool(re.search(rf"各\s*({_NUMBER})\s*{_UNIT}?\s*$", text))
    each_quantity = None
    if each:
        match = re.search(rf"各\s*({_NUMBER})\s*{_UNIT}?\s*$", text)
        assert match is not None
        each_quantity = _quantity(match[1])
        text = text[: match.start()]

    quantities: Counter[str] = Counter()
    position = 0
    previous_implicit = False
    for match in pattern.finditer(text):
        if position > 0 and match.start() == position and previous_implicit:
            raise AnswerNeedsReview("尺寸與數量連在一起，請用逗號分隔每個規格")
        if re.sub(r"[\s,，、;；/／+&()\[\]。.：:]", "", text[position : match.start()]):
            raise AnswerNeedsReview("含無法辨識的規格或說明")
        raw_size = match["after_size"] or match["before_size"] or match["single"]
        key = re.sub(r"\s*(號|碼)$", "", raw_size).strip()
        raw_quantity = match["after_n"] or match["before_n"]
        if each_quantity is not None and raw_quantity is not None:
            raise AnswerNeedsReview("各尺寸數量與「各」的說明混用")
        quantity = _quantity(raw_quantity) if raw_quantity else each_quantity or 1
        quantities[by_size[aliases[key]]] += quantity
        position = match.end()
        previous_implicit = raw_quantity is None
    if not quantities or re.sub(r"[\s,，、;；/／+&()\[\]。.]", "", text[position:]):
        raise AnswerNeedsReview("尺寸缺漏、未知尺寸或數量不明")
    if any(quantity > 100 for quantity in quantities.values()):
        raise AnswerNeedsReview("每個規格的合計數量不可超過 100")
    if expected_total is not None and sum(quantities.values()) != expected_total:
        raise AnswerNeedsReview("尺寸明細與填寫總數不一致")
    return [ParsedVariant(value, quantity) for value, quantity in quantities.items()]


def product_label(header: str) -> str:
    """只去掉表單的標價與括號，不以模糊相似度選商品。"""
    text = normalize(header)
    text = re.split(r"\s*NT\.?\s*\$?\s*\d", text)[0]
    text = re.sub(r"\([^)]*\)", "", text)
    return re.sub(r"[\s\-_]", "", text)
