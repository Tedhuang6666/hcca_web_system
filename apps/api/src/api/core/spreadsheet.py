"""試算表匯出的公式注入防護（CSV／XLSX 共用）。

使用者可控制的文字若以 = + - @ 開頭，Excel／Google 試算表開啟時會當成公式執行，
可用來外連或誤導管理者。匯出前一律在前面加上單引號，讓內容以文字呈現。
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

_FORMULA_PREFIXES = ("=", "+", "-", "@")


def safe_cell(value: Any) -> Any:
    if isinstance(value, str) and value.lstrip(" \t\r\n").startswith(_FORMULA_PREFIXES):
        return f"'{value}"
    return value


def safe_row(values: Iterable[Any]) -> list[Any]:
    return [safe_cell(value) for value in values]


def safe_mapping(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: safe_cell(value) for key, value in row.items()}
