"""搜尋相關小工具。"""

from __future__ import annotations

#: 與下方 like_contains 搭配使用的 LIKE escape 字元。
LIKE_ESCAPE = "\\"


def like_escape(term: str) -> str:
    """轉義使用者輸入中的 LIKE 萬用字元（% _ \\），

    避免「50%」「a_b」這類字串被當成萬用字元而比對到非預期結果。
    與 `.ilike(pattern, escape=LIKE_ESCAPE)` 搭配使用。
    """
    return term.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2).replace("%", r"\%").replace("_", r"\_")


def like_contains(term: str) -> str:
    """回傳已轉義、可安全用於模糊比對的 `%term%` pattern。"""
    return f"%{like_escape(term)}%"
