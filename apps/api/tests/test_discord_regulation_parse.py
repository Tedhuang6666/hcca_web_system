"""法條引用解析的單元測試（純函式，不需 DB）。"""

from __future__ import annotations

from api.discord_cogs._regulation_parse import (
    _cn_to_int,
    _is_subsequence,
    _strip_leading_particle,
    parse_citations,
)


def test_cn_to_int_basic():
    assert _cn_to_int("三") == 3
    assert _cn_to_int("十") == 10
    assert _cn_to_int("十二") == 12
    assert _cn_to_int("二十一") == 21
    assert _cn_to_int("一百零三") == 103
    assert _cn_to_int("5") == 5
    assert _cn_to_int("公") is None


def test_strip_leading_particle():
    assert _strip_leading_particle("依公民投票法") == "公民投票法"
    assert _strip_leading_particle("違反組織章程") == "組織章程"
    # 過短或無前綴不應誤剝
    assert _strip_leading_particle("公民投票法") == "公民投票法"


def test_parse_arabic_and_cn_numerals():
    cites = parse_citations("依公民投票法第十條之一第二項第三款")
    assert len(cites) == 1
    c = cites[0]
    assert c.law == "公民投票法"
    assert c.legal_number == "10-1"
    assert c.paragraph == "2"
    assert c.subparagraph == "3"


def test_parse_abbreviations():
    # 「組織章程」「選罷委條例」等簡稱也要能被抓出（法名以法定後綴結尾）
    cites = parse_citations("組織章程第十二條第2項 與 選罷委條例第3條")
    laws = {(c.law, c.legal_number) for c in cites}
    assert ("組織章程", "12") in laws
    assert ("選罷委條例", "3") in laws


def test_parse_none_and_dedup():
    assert parse_citations("這段話沒有任何法條引用") == []
    # 同一引用重複只回一次
    cites = parse_citations("組織章程第5條，又見組織章程第5條")
    assert len(cites) == 1


def test_subsequence_matching():
    full_a = "國立新竹高級中學班級聯合自治會組織章程"
    full_b = "國立新竹高級中學班級聯合自治會選舉及罷免事務委員會組織自治條例"
    assert _is_subsequence("組織章程", full_a)
    assert _is_subsequence("選罷委條例", full_b)
    assert not _is_subsequence("選罷委條例", full_a)
