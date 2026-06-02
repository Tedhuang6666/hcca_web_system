"""法條引用解析：從自由文字中抓出「XX法第X條第X項第X款」並查出條文。

支援阿拉伯與中文數字（十一、二十一、一百零三…），以及「第5條之1 → legal_number 5-1」。
解析結果交給 listener 與 /quote 共用。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.regulation import Regulation, RegulationArticle

_CN_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "兩": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}

# 法規名稱常見結尾，用來界定「法名」邊界
_LAW_SUFFIX = "(?:法|條例|通則|規則|辦法|準則|細則|綱要|章程|要點|自治條例)"

# 引用句常見的開頭虛字 / 連接詞，需從擷取到的法名前緣剝除
# （例：「依公民投票法」→「公民投票法」、「又見組織章程」→「組織章程」）。
# 由長到短排序，迭代剝除直到穩定。
_LEADING_PARTICLES = (
    "依據",
    "依照",
    "按照",
    "參見",
    "參照",
    "爰依",
    "根據",
    "違反",
    "適用",
    "又見",
    "依",
    "按",
    "又",
    "再",
    "見",
    "查",
    "並",
    "復",
    "和",
    "或",
    "及",
    "與",
)


def _strip_leading_particle(law: str) -> str:
    changed = True
    while changed:
        changed = False
        for particle in _LEADING_PARTICLES:
            if law.startswith(particle) and len(law) > len(particle) + 1:
                law = law[len(particle) :]
                changed = True
                break
    return law


# 例：公民投票法第十條之一第二項第三款 / 學生自治會組織章程第 5 條
_CITATION_RE = re.compile(
    r"《?(?P<law>[一-鿿]{2,30}?" + _LAW_SUFFIX + r")》?"
    r"第\s*(?P<article>[0-9〇零一二三四五六七八九十百千兩]+)\s*條"
    r"(?:之\s*(?P<sub_article>[0-9〇零一二三四五六七八九十百千兩]+))?"
    r"(?:第\s*(?P<para>[0-9〇零一二三四五六七八九十百千兩]+)\s*項)?"
    r"(?:第\s*(?P<sub>[0-9〇零一二三四五六七八九十百千兩]+)\s*款)?"
)


@dataclass(frozen=True)
class Citation:
    law: str
    legal_number: str  # 對應 RegulationArticle.legal_number，如 "10" / "10-1"
    paragraph: str | None
    subparagraph: str | None

    @property
    def human(self) -> str:
        base = f"{self.law} 第 {self.legal_number.replace('-', ' 條之 ')} 條"
        if self.paragraph:
            base += f" 第 {self.paragraph} 項"
        if self.subparagraph:
            base += f" 第 {self.subparagraph} 款"
        return base


def _cn_to_int(text: str) -> int | None:
    """中文/阿拉伯數字 → int。支援到千位的常見寫法。"""
    text = text.strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    total = 0
    section = 0
    number = 0
    units = {"十": 10, "百": 100, "千": 1000}
    for ch in text:
        if ch in _CN_DIGITS:
            number = _CN_DIGITS[ch]
        elif ch in units:
            unit = units[ch]
            section += (number or 1) * unit
            number = 0
        else:
            return None
    return total + section + number


def _normalize_number(article: str, sub_article: str | None) -> str | None:
    a = _cn_to_int(article)
    if a is None:
        return None
    if sub_article:
        s = _cn_to_int(sub_article)
        if s is None:
            return None
        return f"{a}-{s}"
    return str(a)


def parse_citations(text: str, *, limit: int = 3) -> list[Citation]:
    """從文字抓出法條引用（最多 limit 條，去重）。"""
    seen: set[tuple] = set()
    out: list[Citation] = []
    for m in _CITATION_RE.finditer(text or ""):
        legal_number = _normalize_number(m.group("article"), m.group("sub_article"))
        if legal_number is None:
            continue
        para = _cn_to_int(m.group("para")) if m.group("para") else None
        sub = _cn_to_int(m.group("sub")) if m.group("sub") else None
        cite = Citation(
            law=_strip_leading_particle(m.group("law")),
            legal_number=legal_number,
            paragraph=str(para) if para is not None else None,
            subparagraph=str(sub) if sub is not None else None,
        )
        key = (cite.law, cite.legal_number, cite.paragraph, cite.subparagraph)
        if key in seen:
            continue
        seen.add(key)
        out.append(cite)
        if len(out) >= limit:
            break
    return out


def _is_subsequence(needle: str, haystack: str) -> bool:
    """needle 的每個字元是否依序出現在 haystack 中（允許中間有其他字元）。

    用來比對簡稱：如「選罷委條例」對「…選舉及罷免事務委員會組織自治條例」。
    """
    it = iter(haystack)
    return all(ch in it for ch in needle)


async def _match_regulation(db: AsyncSession, law: str) -> Regulation | None:
    """依法名（含簡稱）找出最可能的法規。

    比對順序：
    1. title 含 law（substring，涵蓋「組織章程」這類為完整標題尾段的簡稱）
    2. law 含 title（標題較短時）
    3. 子序列比對（涵蓋「選罷委條例」這類抽字簡稱），取符合且標題最短者
    """
    reg = await db.scalar(
        select(Regulation)
        .where(Regulation.is_active.is_(True))
        .where(Regulation.title.ilike(f"%{law}%"))
        .order_by(Regulation.updated_at.desc())
        .limit(1)
    )
    if reg is not None:
        return reg

    candidates = (
        (
            await db.execute(
                select(Regulation)
                .where(Regulation.is_active.is_(True))
                .order_by(Regulation.updated_at.desc())
                .limit(300)
            )
        )
        .scalars()
        .all()
    )

    reg = next((r for r in candidates if r.title and r.title in law), None)
    if reg is not None:
        return reg

    # 子序列簡稱比對（law 至少 3 字才啟用，避免過度寬鬆）
    if len(law) >= 3:
        matches = [r for r in candidates if r.title and _is_subsequence(law, r.title)]
        if matches:
            # 取標題最短者（最貼近簡稱、最不易誤判）
            return min(matches, key=lambda r: len(r.title))
    return None


async def lookup_citation(
    db: AsyncSession, citation: Citation
) -> tuple[Regulation, RegulationArticle] | None:
    """依法名（含簡稱）＋條號查出條文。找不到回 None。"""
    reg = await _match_regulation(db, citation.law)
    if reg is None:
        return None
    article = await db.scalar(
        select(RegulationArticle)
        .where(RegulationArticle.regulation_id == reg.id)
        .where(RegulationArticle.is_deleted.is_(False))
        .where(RegulationArticle.legal_number == citation.legal_number)
        .limit(1)
    )
    if article is None:
        return None
    return reg, article


__all__ = ["Citation", "lookup_citation", "parse_citations"]
