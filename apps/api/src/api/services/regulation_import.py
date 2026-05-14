"""法規文檔匯入器。

將一般 Word/PDF 法規文字轉為現有 Regulation / RegulationArticle 可用的中介結構。
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from api.models.regulation import ArticleType

_WORD_NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
_NUMERAL_CHARS = "零〇一二三四五六七八九十百千兩"
_STRUCTURAL_RE = re.compile(rf"^第\s*([{_NUMERAL_CHARS}0-9０-９\-]+)\s*(編|章|節)\s*(.*)$")
_ARTICLE_RE = re.compile(rf"^第\s*([{_NUMERAL_CHARS}0-9０-９\-]+)\s*條\s*(.*)$")
_SUBPARAGRAPH_RE = re.compile(rf"(^|[：:。；;\n])([{_NUMERAL_CHARS}]+)、")
_HISTORY_KEYWORDS = (
    "制定",
    "制訂",
    "訂定",
    "修正",
    "修訂",
    "增訂",
    "刪除",
    "通過",
    "公布",
    "發布",
    "公告",
    "施行",
    "廢止",
    "核定",
    "備查",
)
_HISTORY_HEADING_RE = re.compile(r"^(歷史沿革|沿革|立法沿革|修正沿革|制修訂紀錄)[:：]?$")


@dataclass(frozen=True)
class ImportedRegulationArticle:
    key: str
    parent_key: str | None
    article_type: ArticleType
    title: str
    legal_number: str | None
    content: str | None
    sort_index: int
    order_index: int


@dataclass(frozen=True)
class ImportedRegulationDraft:
    title: str
    preface: str | None
    legislative_history: str | None
    content: str
    articles: list[ImportedRegulationArticle]
    warnings: list[str]


def parse_regulation_document(
    file_bytes: bytes, filename: str | None = None
) -> ImportedRegulationDraft:
    return _parse_regulation_paragraphs(_extract_paragraphs(file_bytes, filename=filename))


def parse_regulation_docx(
    file_bytes: bytes, filename: str | None = None
) -> ImportedRegulationDraft:
    return _parse_regulation_paragraphs(_extract_docx_paragraphs(file_bytes, filename=filename))


def parse_regulation_pdf(file_bytes: bytes, filename: str | None = None) -> ImportedRegulationDraft:
    return _parse_regulation_paragraphs(_extract_pdf_paragraphs(file_bytes, filename=filename))


def _parse_regulation_paragraphs(paragraphs: list[str]) -> ImportedRegulationDraft:
    if not paragraphs:
        raise ValueError("文件內沒有可匯入的文字內容")

    first_structural_index = _find_first_structural_index(paragraphs)
    if first_structural_index is None:
        raise ValueError("找不到「第○章」或「第○條」格式的法規條文")

    title_candidates = paragraphs[:first_structural_index]
    title = title_candidates[0].strip() if title_candidates else ""
    if not title:
        raise ValueError("找不到法規名稱")

    preface_parts: list[str] = []
    history_parts: list[str] = []
    in_history_block = False
    for line in title_candidates[1:]:
        if _HISTORY_HEADING_RE.match(line):
            in_history_block = True
            continue
        if in_history_block or _looks_like_history(line):
            history_parts.extend(_split_history_line(line))
        else:
            preface_parts.append(line)

    articles: list[ImportedRegulationArticle] = []
    warnings: list[str] = []
    stack: dict[ArticleType, str] = {}
    sibling_count: defaultdict[str | None, int] = defaultdict(int)
    sort_index = 0
    last_article_index: int | None = None

    def add_article(
        *,
        article_type: ArticleType,
        title: str,
        legal_number: str | None,
        content: str | None,
        parent_key: str | None,
    ) -> str:
        nonlocal sort_index
        sort_index += 1
        sibling_count[parent_key] += 1
        key = f"node-{sort_index}"
        articles.append(
            ImportedRegulationArticle(
                key=key,
                parent_key=parent_key,
                article_type=article_type,
                title=title.strip(),
                legal_number=legal_number,
                content=_clean_content(content),
                sort_index=sort_index,
                order_index=sibling_count[parent_key] - 1,
            )
        )
        return key

    for line in paragraphs[first_structural_index:]:
        structural_match = _STRUCTURAL_RE.match(line)
        if structural_match:
            raw_number, kind, heading = structural_match.groups()
            article_type = _structural_type(kind)
            parent_key = _parent_for_structural(article_type, stack)
            key = add_article(
                article_type=article_type,
                title=heading,
                legal_number=_normalize_legal_number(raw_number),
                content=None,
                parent_key=parent_key,
            )
            _reset_stack_for_structural(article_type, stack)
            stack[article_type] = key
            last_article_index = None
            continue

        article_match = _ARTICLE_RE.match(line)
        if article_match:
            raw_number, body = article_match.groups()
            parent_key = _nearest_parent_key(stack)
            key = add_article(
                article_type=ArticleType.ARTICLE,
                title="",
                legal_number=_normalize_legal_number(raw_number),
                content=body,
                parent_key=parent_key,
            )
            last_article_index = len(articles) - 1
            _split_inline_subparagraphs(articles, key, sibling_count, base_sort_index=sort_index)
            sort_index = len(articles)
            continue

        if last_article_index is not None:
            current = articles[last_article_index]
            merged_content = "\n".join(part for part in (current.content, line) if part)
            articles[last_article_index] = ImportedRegulationArticle(
                **{**current.__dict__, "content": merged_content}
            )
            _split_inline_subparagraphs(
                articles, current.key, sibling_count, base_sort_index=sort_index
            )
            sort_index = len(articles)
        else:
            preface_parts.append(line)

    if not any(a.article_type == ArticleType.ARTICLE for a in articles):
        raise ValueError("找不到「第○條」格式的條文")

    content = _render_markdown(title, history_parts, preface_parts, articles)
    return ImportedRegulationDraft(
        title=title,
        preface="\n".join(preface_parts).strip() or None,
        legislative_history="\n".join(history_parts).strip() or None,
        content=content,
        articles=articles,
        warnings=warnings,
    )


def _extract_paragraphs(file_bytes: bytes, *, filename: str | None = None) -> list[str]:
    suffix = (filename or "").lower().rsplit(".", maxsplit=1)[-1]
    if suffix == "docx":
        return _extract_docx_paragraphs(file_bytes, filename=filename)
    if suffix == "pdf":
        return _extract_pdf_paragraphs(file_bytes, filename=filename)
    raise ValueError("請上傳 .docx 或 .pdf 文件")


def _extract_docx_paragraphs(file_bytes: bytes, *, filename: str | None = None) -> list[str]:
    if filename and not filename.lower().endswith(".docx"):
        raise ValueError("請上傳 .docx Word 文件")
    try:
        with ZipFile(BytesIO(file_bytes)) as docx:
            document_xml = docx.read("word/document.xml")
    except (BadZipFile, KeyError) as exc:
        raise ValueError("無法讀取 DOCX 內容，請確認檔案格式正確") from exc

    root = ET.fromstring(document_xml)
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", _WORD_NS):
        parts = [text.text or "" for text in paragraph.findall(".//w:t", _WORD_NS)]
        line = "".join(parts).strip()
        if line:
            paragraphs.append(_normalize_spacing(line))
    return paragraphs


def _extract_pdf_paragraphs(file_bytes: bytes, *, filename: str | None = None) -> list[str]:
    if filename and not filename.lower().endswith(".pdf"):
        raise ValueError("請上傳 .pdf 文件")
    try:
        reader = PdfReader(BytesIO(file_bytes))
    except PdfReadError as exc:
        raise ValueError("無法讀取 PDF 內容，請確認檔案格式正確") from exc

    paragraphs: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        for line in text.splitlines():
            normalized = _normalize_spacing(line)
            if normalized:
                paragraphs.append(normalized)
    if not paragraphs:
        raise ValueError("PDF 內沒有可匯入的文字內容，若為掃描檔需先 OCR")
    return _merge_pdf_continuation_lines(paragraphs)


def _merge_pdf_continuation_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        if not merged or _STRUCTURAL_RE.match(line) or _ARTICLE_RE.match(line):
            merged.append(line)
            continue
        if _looks_like_history(line):
            merged.append(line)
            continue
        merged[-1] = f"{merged[-1]}{line}"
    return merged


def _find_first_structural_index(paragraphs: list[str]) -> int | None:
    for index, line in enumerate(paragraphs):
        if _STRUCTURAL_RE.match(line) or _ARTICLE_RE.match(line):
            return index
    return None


def _looks_like_history(line: str) -> bool:
    if any(keyword in line for keyword in _HISTORY_KEYWORDS) and (
        "年" in line or re.search(r"\d{2,4}[./-]\d{1,2}[./-]\d{1,2}", line)
    ):
        return True
    return bool(re.match(r"^(中華民國|民國)?\s*\d{2,4}\s*年", line)) and any(
        keyword in line for keyword in _HISTORY_KEYWORDS
    )


def _split_history_line(line: str) -> list[str]:
    normalized = line.strip()
    if not normalized:
        return []
    pattern = re.compile(
        r"\s+(?=(?:中華民國|民國)\s*\d{2,4}\s*年|\d{2,4}\s*學年度|\d{2,4}[./-]\d{1,2}[./-]\d{1,2})"
    )
    return [part.strip() for part in pattern.split(normalized) if part.strip()]


def _structural_type(kind: str) -> ArticleType:
    return {
        "編": ArticleType.VOLUME,
        "章": ArticleType.CHAPTER,
        "節": ArticleType.SECTION,
    }[kind]


def _parent_for_structural(article_type: ArticleType, stack: dict[ArticleType, str]) -> str | None:
    if article_type == ArticleType.VOLUME:
        return None
    if article_type == ArticleType.CHAPTER:
        return stack.get(ArticleType.VOLUME)
    if article_type == ArticleType.SECTION:
        return stack.get(ArticleType.CHAPTER) or stack.get(ArticleType.VOLUME)
    return None


def _nearest_parent_key(stack: dict[ArticleType, str]) -> str | None:
    return (
        stack.get(ArticleType.SECTION)
        or stack.get(ArticleType.CHAPTER)
        or stack.get(ArticleType.VOLUME)
    )


def _reset_stack_for_structural(article_type: ArticleType, stack: dict[ArticleType, str]) -> None:
    if article_type == ArticleType.VOLUME:
        stack.pop(ArticleType.CHAPTER, None)
        stack.pop(ArticleType.SECTION, None)
    elif article_type == ArticleType.CHAPTER:
        stack.pop(ArticleType.SECTION, None)


def _split_inline_subparagraphs(
    articles: list[ImportedRegulationArticle],
    article_key: str,
    sibling_count: defaultdict[str | None, int],
    *,
    base_sort_index: int,
) -> None:
    article_index = next(
        (index for index, row in enumerate(articles) if row.key == article_key), None
    )
    if article_index is None:
        return
    article = articles[article_index]
    content = article.content or ""
    matches = list(_SUBPARAGRAPH_RE.finditer(content))
    if len(matches) < 2:
        return

    lead = content[: matches[0].start(2)].strip()
    split_rows: list[ImportedRegulationArticle] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start(2) if index + 1 < len(matches) else len(content)
        item_content = content[start:end].strip()
        if not item_content:
            continue
        sibling_count[article_key] += 1
        sort_index = base_sort_index + len(split_rows) + 1
        split_rows.append(
            ImportedRegulationArticle(
                key=f"node-{sort_index}",
                parent_key=article_key,
                article_type=ArticleType.SUBPARAGRAPH,
                title="",
                legal_number=str(_chinese_to_int(match.group(2))),
                content=item_content,
                sort_index=sort_index,
                order_index=sibling_count[article_key] - 1,
            )
        )

    if not split_rows:
        return
    articles[article_index] = ImportedRegulationArticle(**{**article.__dict__, "content": lead})
    insert_at = article_index + 1
    del articles[
        insert_at : insert_at
        + len([row for row in articles[insert_at:] if row.parent_key == article_key])
    ]
    for offset, row in enumerate(split_rows):
        articles.insert(insert_at + offset, row)
    for index, row in enumerate(articles, start=1):
        articles[index - 1] = ImportedRegulationArticle(**{**row.__dict__, "sort_index": index})


def _render_markdown(
    title: str,
    history_parts: list[str],
    preface_parts: list[str],
    articles: list[ImportedRegulationArticle],
) -> str:
    lines = [f"# {title}"]
    if history_parts:
        lines.extend(["", *history_parts])
    if preface_parts:
        lines.extend(["", *preface_parts])

    for row in articles:
        if row.article_type in (ArticleType.VOLUME, ArticleType.CHAPTER, ArticleType.SECTION):
            heading_label = _format_structural_label(row)
            lines.extend(["", f"## {heading_label}".strip()])
            continue
        if row.article_type == ArticleType.ARTICLE:
            lines.extend(["", f"### 第 {row.legal_number or '?'} 條"])
            if row.content:
                lines.append(row.content)
            continue
        if row.article_type == ArticleType.SUBPARAGRAPH and row.content:
            lines.append(f"{row.legal_number or ''}. {row.content}".strip())
    return "\n".join(lines).strip()


def _format_structural_label(row: ImportedRegulationArticle) -> str:
    label = {
        ArticleType.VOLUME: "編",
        ArticleType.CHAPTER: "章",
        ArticleType.SECTION: "節",
    }[row.article_type]
    return f"第 {row.legal_number or '?'} {label} {row.title}".strip()


def _normalize_legal_number(value: str) -> str:
    normalized = value.translate(str.maketrans("０１２３４５６７８９", "0123456789")).strip()
    if re.fullmatch(r"\d+(?:-\d+)?", normalized):
        return normalized
    return str(_chinese_to_int(normalized))


def _chinese_to_int(value: str) -> int:
    value = value.strip().replace("兩", "二").replace("〇", "零")
    if not value:
        return 0
    if value.isdigit():
        return int(value)
    digits = {
        "零": 0,
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
    }
    units = {"十": 10, "百": 100, "千": 1000}
    total = 0
    number = 0
    for char in value:
        if char in digits:
            number = digits[char]
        elif char in units:
            unit = units[char]
            total += (number or 1) * unit
            number = 0
    return total + number


def _normalize_spacing(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _clean_content(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None
