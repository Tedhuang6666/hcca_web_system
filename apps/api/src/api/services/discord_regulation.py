"""Discord 法條引用解析與查詢。"""

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
_LAW_SUFFIX = "(?:法|條例|通則|規則|辦法|準則|細則|綱要|章程|要點|自治條例)"
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
    legal_number: str
    paragraph: str | None
    subparagraph: str | None


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


def _cn_to_int(text: str) -> int | None:
    text = text.strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    section = 0
    number = 0
    units = {"十": 10, "百": 100, "千": 1000}
    for char in text:
        if char in _CN_DIGITS:
            number = _CN_DIGITS[char]
        elif char in units:
            section += (number or 1) * units[char]
            number = 0
        else:
            return None
    return section + number


def parse_citations(text: str, *, limit: int = 3) -> list[Citation]:
    seen: set[tuple[str, str, str | None, str | None]] = set()
    citations: list[Citation] = []
    for match in _CITATION_RE.finditer(text or ""):
        article = _cn_to_int(match.group("article"))
        sub_article = _cn_to_int(match.group("sub_article")) if match.group("sub_article") else None
        if article is None:
            continue
        legal_number = f"{article}-{sub_article}" if sub_article is not None else str(article)
        paragraph = _cn_to_int(match.group("para")) if match.group("para") else None
        subparagraph = _cn_to_int(match.group("sub")) if match.group("sub") else None
        citation = Citation(
            law=_strip_leading_particle(match.group("law")),
            legal_number=legal_number,
            paragraph=str(paragraph) if paragraph is not None else None,
            subparagraph=str(subparagraph) if subparagraph is not None else None,
        )
        key = (
            citation.law,
            citation.legal_number,
            citation.paragraph,
            citation.subparagraph,
        )
        if key not in seen:
            seen.add(key)
            citations.append(citation)
        if len(citations) >= limit:
            break
    return citations


def _is_subsequence(needle: str, haystack: str) -> bool:
    iterator = iter(haystack)
    return all(char in iterator for char in needle)


async def lookup_citation(
    db: AsyncSession, citation: Citation
) -> tuple[Regulation, RegulationArticle] | None:
    regulation = await db.scalar(
        select(Regulation)
        .where(Regulation.is_active.is_(True), Regulation.title.ilike(f"%{citation.law}%"))
        .order_by(Regulation.updated_at.desc())
        .limit(1)
    )
    if regulation is None:
        candidates = (
            await db.execute(
                select(Regulation)
                .where(Regulation.is_active.is_(True))
                .order_by(Regulation.updated_at.desc())
                .limit(300)
            )
        ).scalars()
        rows = list(candidates)
        regulation = next((row for row in rows if row.title and row.title in citation.law), None)
        if regulation is None and len(citation.law) >= 3:
            matches = [
                row for row in rows if row.title and _is_subsequence(citation.law, row.title)
            ]
            regulation = min(matches, key=lambda row: len(row.title)) if matches else None
    if regulation is None:
        return None
    article = await db.scalar(
        select(RegulationArticle).where(
            RegulationArticle.regulation_id == regulation.id,
            RegulationArticle.is_deleted.is_(False),
            RegulationArticle.legal_number == citation.legal_number,
        )
    )
    return (regulation, article) if article is not None else None


__all__ = [
    "Citation",
    "_cn_to_int",
    "_is_subsequence",
    "_strip_leading_particle",
    "lookup_citation",
    "parse_citations",
]
