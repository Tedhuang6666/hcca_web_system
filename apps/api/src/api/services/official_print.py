"""Official print HTML templates for documents and regulations."""

from __future__ import annotations

import base64
import datetime as dt
import re
from collections.abc import Sequence
from io import BytesIO

from api.core.clock import TAIPEI
from api.models.petition import PetitionCase
from api.models.regulation import Regulation
from api.services.official_print_common import (
    _BUNDLED_KAI_FONT as _BUNDLED_KAI_FONT,
)
from api.services.official_print_common import (
    _BUNDLED_LISHU_FONT as _BUNDLED_LISHU_FONT,
)
from api.services.official_print_common import (
    _BUNDLED_TITLE_FONT as _BUNDLED_TITLE_FONT,
)
from api.services.official_print_common import (
    _BUNDLED_XINGSHU_FONT as _BUNDLED_XINGSHU_FONT,
)
from api.services.official_print_common import (
    _FALLBACK_KAI_FONT as _FALLBACK_KAI_FONT,
)
from api.services.official_print_common import (
    _SCHOOL_FULL_NAME,
    _enum_value,
    _esc,
    _font_faces,
)
from api.services.official_print_common import (
    _bundled_font_candidates as _bundled_font_candidates,
)
from api.services.official_print_common import (
    _decree_issuer_title as _decree_issuer_title,
)
from api.services.official_print_common import (
    _final_signature_html as _final_signature_html,
)
from api.services.official_print_common import (
    _full_org_name as _full_org_name,
)
from api.services.official_print_common import (
    _official_document_title as _official_document_title,
)
from api.services.official_print_common import (
    _position_title as _position_title,
)
from api.services.official_print_document import (
    render_document_print_html as render_document_print_html,
)

_CN_DIGITS = "零一二三四五六七八九"


def render_print_pdf(html_content: str) -> bytes:
    """Render official print HTML to PDF bytes."""
    from weasyprint import HTML

    return HTML(string=html_content, base_url="/").write_pdf()


def _br(value: str | None) -> str:
    return _esc(value).replace("\n", "<br>")


def _cn_number(num: int) -> str:
    if num <= 0:
        return str(num)
    if num < 10:
        return _CN_DIGITS[num]
    if num == 10:
        return "十"
    if num < 20:
        return "十" + _CN_DIGITS[num % 10]
    if num < 100:
        tens, ones = divmod(num, 10)
        return _CN_DIGITS[tens] + "十" + (_CN_DIGITS[ones] if ones else "")
    hundreds, rest = divmod(num, 100)
    return _CN_DIGITS[hundreds] + "百" + (_cn_number(rest) if rest else "")


def _clean_markdown_line(line: str) -> str:
    line = line.strip()
    line = re.sub(r"^#{1,6}\s*", "", line)
    line = re.sub(r"^\s*[-*+]\s+", "", line)
    return line


def _paragraphs(text: str | None) -> list[str]:
    if not text:
        return []
    return [_clean_markdown_line(part) for part in re.split(r"\n\s*\n", text) if part.strip()]


def _law_revision_rows(reg: Regulation) -> str:
    revisions = sorted(reg.revisions or [], key=lambda item: item.amended_at)
    term_counts: dict[tuple[int, str], int] = {}
    rows: list[str] = []
    for rev in revisions:
        if rev.amended_at_precision == "unknown":
            rows.append("<div>修訂日期不詳</div>")
            continue
        if rev.amended_at_precision == "year":
            year = rev.amended_year or rev.amended_at.year
            rows.append(f"<div>{_esc(str(year))}年修訂</div>")
            continue
        month = rev.amended_at.month
        if month >= 8:
            academic_year = rev.amended_at.year - 1911
            semester = "第一"
        else:
            academic_year = rev.amended_at.year - 1912
            semester = "第一" if month == 1 else "第二"
        term_key = (academic_year, semester)
        term_counts[term_key] = term_counts.get(term_key, 0) + 1
        label = (
            f"{academic_year}學年度第{semester}學期"
            f"第{_cn_number(term_counts[term_key])}次學生議會修訂"
        )
        rows.append(f"<div>{_esc(label)}</div>")
    return "".join(rows)


def _law_history_rows(reg: Regulation) -> str:
    rows: list[str] = []
    history = (getattr(reg, "legislative_history", None) or "").strip()
    if history:
        history = re.sub(
            r"\s+(?=(?:中華民國|民國)\s*\d{2,4}\s*年|\d{2,4}\s*學年度|\d{2,4}[./-]\d{1,2}[./-]\d{1,2})",
            "\n",
            history,
        )
        rows.extend(
            f"<div>{_br(line.strip())}</div>" for line in history.splitlines() if line.strip()
        )
        return "".join(rows)
    return _law_revision_rows(reg)


def _article_html(label: str, body: str, *, cls: str = "article-row") -> str:
    return (
        f'<div class="{cls}">'
        f'<div class="article-label">{label}</div>'
        f'<div class="article-body">{body}</div>'
        "</div>"
    )


def _nested_article_html(label: str, body: str, *, cls: str) -> str:
    return (
        f'<div class="nested-article-row {cls}">'
        f'<span class="nested-label">{label}</span>'
        f'<span class="nested-body">{body or "&nbsp;"}</span>'
        "</div>"
    )


def _law_number(legal_number: str | None, fallback: int) -> str:
    raw = str(legal_number or "").strip()
    if not raw:
        return _cn_number(fallback)
    raw = re.sub(r"^第\s*", "", raw)
    raw = re.sub(r"\s*[編章節條項款目]$", "", raw)
    raw = raw.strip()
    return _cn_number(int(raw)) if raw.isdigit() else raw


_INLINE_SUBPARAGRAPH_RE = re.compile(r"(?P<label>[一二三四五六七八九十百零〇]+)、")


def _split_inline_subparagraphs(text: str | None) -> tuple[str, list[tuple[str, str]]]:
    """Separate enumerated subparagraphs that were merged into an imported article."""
    source = str(text or "").strip()
    matches = list(_INLINE_SUBPARAGRAPH_RE.finditer(source))
    if not matches:
        return source, []

    prefix = source[: matches[0].start()].strip()
    items = [
        (
            match.group("label"),
            source[
                match.end() : matches[index + 1].start() if index + 1 < len(matches) else None
            ].strip(),
        )
        for index, match in enumerate(matches)
    ]
    return prefix, items


def _law_content_html(text: str | None) -> str:
    """Restore sentence breaks lost while importing Word/PDF regulation files."""
    return re.sub(r"。(?=.)", "。<br>", _br(text))


def _render_structured_articles(reg: Regulation) -> str:
    articles = sorted(
        [article for article in (reg.articles or []) if not article.is_deleted],
        key=lambda article: article.sort_index,
    )
    if not articles:
        return ""

    counters = {
        key: 0
        for key in (
            "volume",
            "chapter",
            "section",
            "article",
            "paragraph",
            "subparagraph",
            "item",
        )
    }
    chunks: list[str] = []
    for index, article in enumerate(articles):
        article_type = _enum_value(article.article_type)
        next_article_type = (
            _enum_value(articles[index + 1].article_type) if index + 1 < len(articles) else None
        )
        raw_content, inline_subparagraphs = _split_inline_subparagraphs(article.content)
        content = _law_content_html(raw_content)
        title = _esc(article.title or article.subtitle or "")
        body = "　".join(part for part in [title, content] if part)

        if article_type == "volume":
            counters["volume"] += 1
            counters["chapter"] = counters["section"] = counters["article"] = 0
            counters["paragraph"] = counters["subparagraph"] = counters["item"] = 0
            chunks.append(
                _article_html(
                    f"第{_law_number(article.legal_number, counters['volume'])}編",
                    title,
                    cls="chapter-row",
                )
            )
        elif article_type == "chapter":
            counters["chapter"] += 1
            counters["section"] = counters["article"] = 0
            counters["paragraph"] = counters["subparagraph"] = counters["item"] = 0
            chunks.append(
                _article_html(
                    f"第{_law_number(article.legal_number, counters['chapter'])}章",
                    title,
                    cls="chapter-row",
                )
            )
        elif article_type == "section":
            counters["section"] += 1
            counters["article"] = counters["paragraph"] = counters["subparagraph"] = 0
            counters["item"] = 0
            chunks.append(
                _article_html(
                    f"第{_law_number(article.legal_number, counters['section'])}節",
                    title,
                    cls="chapter-row",
                )
            )
        elif article_type == "article":
            counters["article"] += 1
            counters["paragraph"] = counters["subparagraph"] = counters["item"] = 0
            article_class = (
                "article-row article-with-nested"
                if (
                    inline_subparagraphs
                    or next_article_type in {"paragraph", "subparagraph", "item"}
                )
                else "article-row"
            )
            chunks.append(
                _article_html(
                    f"第{_law_number(article.legal_number, counters['article'])}條",
                    body,
                    cls=article_class,
                )
            )
            chunks.extend(
                _nested_article_html(f"{label}、", _law_content_html(item), cls="subparagraph-row")
                for label, item in inline_subparagraphs
            )
        elif article_type == "paragraph":
            counters["paragraph"] += 1
            counters["subparagraph"] = counters["item"] = 0
            if raw_content:
                chunks.append(
                    _nested_article_html(
                        f"第{_law_number(article.legal_number, counters['paragraph'])}項",
                        body,
                        cls="paragraph-row",
                    )
                )
            chunks.extend(
                _nested_article_html(f"{label}、", _law_content_html(item), cls="subparagraph-row")
                for label, item in inline_subparagraphs
            )
        elif article_type == "subparagraph":
            counters["subparagraph"] += 1
            counters["item"] = 0
            if raw_content:
                chunks.append(
                    _nested_article_html(
                        f"{_law_number(article.legal_number, counters['subparagraph'])}、",
                        body,
                        cls="subparagraph-row",
                    )
                )
            chunks.extend(
                _nested_article_html(f"{label}、", _law_content_html(item), cls="subparagraph-row")
                for label, item in inline_subparagraphs
            )
        elif article_type == "item":
            counters["item"] += 1
            chunks.append(
                _nested_article_html(
                    f"（{_law_number(article.legal_number, counters['item'])}）",
                    body,
                    cls="item-row",
                )
            )
        else:
            chunks.append(_article_html(title or "附則", content, cls="chapter-row"))
    return "".join(chunks)


def _render_markdown_law(text: str | None) -> str:
    chunks: list[str] = []
    for para in _paragraphs(text):
        chapter = re.match(r"^(第[一二三四五六七八九十百零〇\d]+[編章節])\s*(.*)$", para)
        article = re.match(r"^(第[一二三四五六七八九十百零〇\d]+條)\s*(.*)$", para)
        if chapter:
            chunks.append(
                _article_html(_esc(chapter.group(1)), _br(chapter.group(2)), cls="chapter-row")
            )
        elif article:
            chunks.append(_article_html(_esc(article.group(1)), _br(article.group(2))))
        else:
            chunks.append(f'<p class="law-paragraph">{_br(para)}</p>')
    return "".join(chunks)


def render_regulation_print_html(reg: Regulation) -> str:
    """Render a law-compilation style regulation print page."""
    raw_title = str(reg.title or "").strip()
    title = _esc(raw_title)
    title_suffix = raw_title.removeprefix(_SCHOOL_FULL_NAME).strip()
    title_lines = (
        f"<div>{_esc(_SCHOOL_FULL_NAME)}</div><div>{_esc(title_suffix)}</div>"
        if title_suffix and raw_title.startswith(_SCHOOL_FULL_NAME)
        else f"<div>{title}</div>"
    )
    history = _law_history_rows(reg)
    preface = "".join(f'<p class="preface">{_br(item)}</p>' for item in _paragraphs(reg.preface))
    articles = _render_structured_articles(reg) or _render_markdown_law(reg.content)

    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>{title}</title>
  <style>
    {_font_faces()}
    @page {{
      size: letter portrait;
      margin: 4mm 24mm 20mm;
    }}
    * {{ box-sizing: border-box; font-weight: 400 !important; }}
    body {{
      margin: 0;
      color: #000;
      background: #fff;
      font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
      font-size: 12pt;
      line-height: 1.5;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .no-print {{ margin-bottom: 8mm; text-align: right; font-family: system-ui, sans-serif; }}
    .no-print button {{ padding: 5px 14px; border: 1px solid #777; background: #f6f6f6; cursor: pointer; }}
    @media print {{ .no-print {{ display: none; }} }}
    .law-page {{
      width: 164mm;
      margin: 0 auto;
    }}
    .law-title {{
      text-align: center;
      font-size: 20pt;
      line-height: 1.75;
      margin: 20mm 0 1mm;
      letter-spacing: .08em;
      font-weight: 700 !important;
      font-synthesis: weight;
      text-shadow: .2px 0 currentColor, -.2px 0 currentColor;
    }}
    .legislative-history {{
      width: 78mm;
      margin: 0 0 4mm auto;
      font-size: 10.5pt;
      line-height: 1.65;
      text-align: left;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      word-break: break-word;
    }}
    .preface {{
      margin: 0 0 5mm;
      text-align: justify;
    }}
    .chapter-row,
    .article-row {{
      display: grid;
      grid-template-columns: 25mm minmax(0, 1fr);
      column-gap: 2mm;
    }}
    .chapter-row {{
      margin: 4mm 0 1mm;
      font-size: 14pt;
      break-inside: avoid;
      break-after: avoid;
      page-break-after: avoid;
    }}
    .article-row {{
      margin: 3.3mm 0;
      break-inside: auto;
    }}
    .article-with-nested {{ margin-bottom: 0; }}
    .article-label {{ white-space: nowrap; }}
    .article-body {{
      min-width: 0;
      white-space: pre-wrap;
      text-align: justify;
      overflow-wrap: anywhere;
    }}
    .nested-article-row {{
      margin: 0;
      text-align: justify;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      break-inside: avoid;
    }}
    .paragraph-row,
    .subparagraph-row,
    .item-row {{ margin-left: 27mm; }}
    .nested-label,
    .nested-body {{ display: inline; }}
    .law-indent {{
      margin: 1.4mm 0 1.4mm 38mm;
      text-align: justify;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }}
    .level-2 {{ margin-left: 46mm; }}
    .level-3 {{ margin-left: 54mm; }}
    .law-paragraph {{
      margin: 3.3mm 0 3.3mm 38mm;
      text-align: justify;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }}
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  <main class="law-page">
    <header class="law-title">
      {title_lines}
    </header>
    {f'<section class="legislative-history">{history}</section>' if history else ""}
    {preface}
    <section class="articles">{articles}</section>
  </main>
</body>
</html>"""


def _petition_attachment_html(
    attachment_names: Sequence[tuple[int, str, str]],
    image_attachments: Sequence[tuple[int, str, bytes]],
) -> str:
    if not attachment_names:
        return ""

    rows = "".join(
        f"<li><strong>附件 {number}：{_esc(name)}</strong><span>{_esc(kind)}</span></li>"
        for number, name, kind in attachment_names
    )
    image_pages = []
    for number, name, image_bytes in image_attachments:
        from PIL import Image, ImageOps

        try:
            with Image.open(BytesIO(image_bytes)) as source:
                if source.width * source.height > 40_000_000:
                    raise ValueError("圖片尺寸過大，無法列印")
                image = ImageOps.exif_transpose(source)
                image.thumbnail((1800, 2400))
                image = image.convert(
                    "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
                )
                output = BytesIO()
                image.save(output, format="PNG", optimize=True)
        except OSError as exc:
            raise ValueError("圖片附件無法讀取") from exc
        data_uri = base64.b64encode(output.getvalue()).decode("ascii")
        image_pages.append(
            '<figure class="attachment-image">'
            f"<figcaption>附件 {number}：{_esc(name)}</figcaption>"
            f'<img src="data:image/png;base64,{data_uri}" alt="附件 {number}：{_esc(name)}">'
            "</figure>"
        )

    return (
        '<section class="attachment-overview">'
        f"<h2>附件（共 {len(attachment_names)} 份）</h2>"
        f"<ul>{rows}</ul>"
        "</section>"
        f"{''.join(image_pages)}"
    )


def render_petition_print_html(
    case_obj: PetitionCase,
    *,
    attachment_names: Sequence[tuple[int, str, str]] = (),
    image_attachments: Sequence[tuple[int, str, bytes]] = (),
) -> str:
    """Render a petition intake detail sheet in the campus-office format."""

    def print_datetime(value: object | None) -> str:
        if not isinstance(value, dt.datetime):
            return "未載明"
        if value.tzinfo is not None:
            value = value.astimezone(TAIPEI)
        period = "上午" if value.hour < 12 else "下午"
        hour = value.hour % 12 or 12
        return f"{value:%Y/%m/%d} {period} {hour:02d} 點 {value.minute:02d} 分"

    def print_updated_at(value: object | None) -> str:
        if not isinstance(value, dt.datetime):
            return "更新 未載明"
        if value.tzinfo is not None:
            value = value.astimezone(TAIPEI)
        period = "上午" if value.hour < 12 else "下午"
        hour = value.hour % 12 or 12
        return f"更新 {value:%m/%d} {period} {hour:02d} 點 {value.minute:02d} 分"

    assigned_name = (
        getattr(getattr(case_obj, "assigned_to", None), "display_name", None) or "尚未分案"
    )
    contact_email = "hchshcca@gmail.com"
    org_name = getattr(getattr(case_obj, "current_org", None), "name", None) or "未設定"
    type_name = getattr(getattr(case_obj, "type", None), "name", None) or "未分類"
    generated_at = print_datetime(dt.datetime.now(TAIPEI))
    attachments_html = _petition_attachment_html(attachment_names, image_attachments)

    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>{_esc(org_name)}陳情收案詳情</title>
  <style>
    {_font_faces()}
    @page {{
      size: A4 portrait;
      margin: 15mm 15mm 18mm;
      @bottom-center {{
        content: "第 " counter(page) " 頁　共 " counter(pages) " 頁";
        font-family: "OfficialKai", "Noto Sans TC", sans-serif;
        font-size: 9pt;
        color: #64748b;
      }}
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      color: #172033;
      background: #fff;
      font-family: "OfficialKai", "Noto Sans TC", sans-serif;
      font-size: 10.5pt;
      line-height: 1.65;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .no-print {{
      margin: 0 auto 8mm;
      max-width: 178mm;
      text-align: right;
      font-family: system-ui, sans-serif;
    }}
    .no-print button {{
      padding: 6px 14px;
      border: 1px solid #94a3b8;
      border-radius: 5px;
      background: #f8fafc;
      color: #172033;
      cursor: pointer;
    }}
    @media print {{ .no-print {{ display: none; }} }}
    .page {{ width: 178mm; margin: 0 auto; }}
    .print-header {{ border-bottom: 2px solid #173b57; padding-bottom: 5mm; margin-bottom: 5mm; }}
    .brand {{ color: #526477; font-size: 9.5pt; letter-spacing: .08em; }}
    h1 {{ margin: 1mm 0 1mm; color: #173b57; font-size: 21pt; letter-spacing: .04em; line-height: 1.35; }}
    .case-number {{ color: #526477; font-size: 10pt; }}
    .status {{
      display: inline-block;
      margin-top: 3mm;
      padding: 1mm 3mm;
      border: 1px solid #9bb8c5;
      border-radius: 999px;
      color: #155e75;
      font-size: 9.5pt;
    }}
    .notice {{
      margin: 0 0 5mm;
      padding: 2.5mm 3.5mm;
      border: 1px solid #cbd5e1;
      border-color: #9bb8c5;
      color: #526477;
      font-size: 9.5pt;
    }}
    .section {{ margin: 0 0 6mm; break-inside: avoid; }}
    .section-title {{
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8mm;
      margin: 0 0 2.5mm;
      padding-bottom: 1.5mm;
      border-bottom: 1px solid #b8c5d1;
      color: #173b57;
      font-size: 13pt;
    }}
    .section-title span {{ color: #748397; font-size: 8.5pt; font-weight: 400; }}
    table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
    th, td {{
      padding: 2.3mm 2.5mm;
      border: 1px solid #cbd5e1;
      text-align: left;
      vertical-align: top;
      white-space: pre-wrap;
    }}
    th {{ width: 21%; background: #f1f5f9; color: #526477; font-size: 9.5pt; font-weight: 700; }}
    td {{ color: #172033; }}
    .meta-table tr {{ break-inside: avoid; }}
    .content-block {{
      padding: 4mm;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      white-space: pre-wrap;
      min-height: 20mm;
    }}
    .reply-block {{ border-color: #9bb8c5; background: #f1f8f8; }}
    .note-block {{ border-color: #d9c49d; background: #fffaf0; }}
    .empty-copy {{ margin: 0; color: #748397; }}
    .timeline {{ margin: 0; padding: 0 0 0 5mm; border-left: 2px solid #b8c5d1; list-style: none; }}
    .timeline-item {{ position: relative; margin: 0 0 4mm; padding-left: 3mm; break-inside: avoid; }}
    .timeline-item::before {{
      content: "";
      position: absolute;
      top: 3mm;
      left: -6.5mm;
      width: 3mm;
      height: 3mm;
      border: 1px solid #2b7288;
      border-radius: 50%;
      background: #fff;
    }}
    .timeline-item-head {{ display: flex; justify-content: space-between; gap: 5mm; color: #173b57; }}
    .timeline-item-head span {{ flex: 0 0 auto; color: #748397; font-size: 8.5pt; }}
    .timeline-meta {{ margin-top: .5mm; color: #748397; font-size: 8.5pt; }}
    .event-status {{ margin-left: 2mm; color: #526477; }}
    .timeline-content {{ margin-top: 1mm; white-space: pre-wrap; }}
    .attachment-list {{ margin: 0; padding: 0; list-style: none; border: 1px solid #cbd5e1; }}
    .attachment-row {{ display: flex; justify-content: space-between; gap: 5mm; padding: 2.5mm 3mm; break-inside: avoid; }}
    .attachment-row + .attachment-row {{ border-top: 1px solid #cbd5e1; }}
    .attachment-row strong {{ display: block; color: #173b57; }}
    .attachment-row span, .attachment-meta {{ color: #748397; font-size: 8.5pt; }}
    .attachment-meta {{ flex: 0 0 auto; text-align: right; }}
    .print-footer {{ margin-top: 8mm; padding-top: 2.5mm; border-top: 1px solid #cbd5e1; color: #748397; font-size: 8.5pt; text-align: right; }}
    @page {{
      margin: 15mm;
      @bottom-center {{ content: none; }}
    }}
    body {{
      color: #111;
      font-family: "OfficialKai", serif;
      font-size: 13pt;
      line-height: 1.45;
      overflow-wrap: normal;
      word-break: normal;
    }}
    .page {{ width: 146mm; margin: 0 auto; }}
    .print-time {{ margin: 0 0 7mm; font-size: 10.5pt; line-height: 1.4; }}
    h1 {{
      margin: 0 0 3mm;
      font-family: "OfficialKai", "標楷體", "DFKai-SB", serif;
      color: #111;
      font-size: 18pt;
      font-weight: 400;
      line-height: 1.3;
      text-align: center;
    }}
    .case-line {{ margin: 0 0 1mm; line-height: 1.15; }}
    .content-label {{ margin: 1mm 0 1mm; line-height: 1.15; }}
    .petition-content {{
      padding: 2mm 3mm;
      border: 1px solid #111;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .last-updated {{
      margin: 1mm 0 5mm;
      font-size: 10.5pt;
      line-height: 1.4;
      text-align: right;
    }}
    .handler-line {{ margin: 0 0 1mm; }}
    .attachment-overview {{ break-before: page; page-break-before: always; }}
    .attachment-overview h2 {{ margin: 0 0 4mm; padding-bottom: 2mm; border-bottom: 1px solid #111; font-size: 15pt; font-weight: 400; }}
    .attachment-overview ul {{ margin: 0; padding: 0; list-style: none; }}
    .attachment-overview li {{ display: flex; justify-content: space-between; gap: 5mm; padding: 3mm; border: 1px solid #999; }}
    .attachment-overview li + li {{ border-top: 0; }}
    .attachment-overview li span {{ flex: 0 0 auto; color: #555; font-size: 10pt; }}
    .attachment-image {{ break-before: page; page-break-before: always; margin: 0; text-align: center; }}
    .attachment-image figcaption {{ margin: 0 0 4mm; text-align: left; font-size: 13pt; }}
    .attachment-image img {{ display: block; max-width: 100%; max-height: 235mm; margin: 0 auto; object-fit: contain; }}
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  <main class="page">
    <div class="print-time">列印時間：{_esc(generated_at)}</div>
    <h1>{_esc(org_name)}陳情收案詳情</h1>
    <p class="case-line">案件編號：{_esc(case_obj.case_number)}</p>
    <p class="case-line">案件分類：{_esc(type_name)}</p>
    <p class="case-line">案件標題：{_esc(case_obj.title)}</p>
    <p class="content-label">陳情內文：</p>
    <div class="petition-content">{_br(case_obj.content)}</div>
    <p class="last-updated">最後更新：{_esc(print_updated_at(case_obj.updated_at))}</p>
    <p class="handler-line">陳情承辦人：{_esc(assigned_name)}</p>
    <p class="handler-line">聯絡信箱：<a href="mailto:{_esc(contact_email)}">{_esc(contact_email)}</a></p>
    {attachments_html}
  </main>
</body>
</html>"""


def render_petition_attachment_cover_html(
    case_number: str,
    attachment_number: int,
    filename: str,
) -> str:
    """Render a labeled cover page before a document attachment in a case PDF."""
    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <style>
    {_font_faces()}
    @page {{ size: A4 portrait; margin: 18mm; }}
    body {{ margin: 0; color: #111; font-family: "OfficialKai", serif; font-size: 14pt; }}
    main {{ display: flex; min-height: 245mm; flex-direction: column; justify-content: center; }}
    p {{ margin: 0 0 8mm; text-align: center; }}
    h1 {{ margin: 0 0 12mm; text-align: center; font-size: 26pt; font-weight: 400; }}
    .filename {{ padding: 8mm; border: 1px solid #111; overflow-wrap: anywhere; }}
    .case {{ margin-top: 10mm; color: #555; font-size: 11pt; }}
  </style>
</head>
<body>
  <main>
    <p>附件 {attachment_number}</p>
    <h1>陳情案件附件</h1>
    <div class="filename">{_esc(filename)}</div>
    <p class="case">案件編號：{_esc(case_number)}</p>
  </main>
</body>
</html>"""


def render_regulation_amendment_comparison_html(
    *,
    regulation_title: str,
    proposal_title: str,
    rationale: str | None,
    rows: list[dict[str, str]],
) -> str:
    """Render a three-column amendment comparison table."""
    title = _esc(proposal_title)
    reg_title = _esc(regulation_title)
    rationale_html = _br(rationale) if rationale else ""

    def _cell(value: str) -> str:
        text = (value or "").strip() or "無"
        return _br(text)

    table_rows = "".join(
        "<tr>"
        f'<td><div class="change-tag">{_esc(row.get("status"))}</div>'
        f'<div class="article-key">{_esc(row.get("article_key"))}</div>'
        f"{_cell(row.get('revised_text', ''))}</td>"
        f"<td>{_cell(row.get('current_text', ''))}</td>"
        f"<td>{_cell(row.get('note', ''))}</td>"
        "</tr>"
        for row in rows
    )

    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>{title}</title>
  <style>
    {_font_faces()}
    @page {{
      size: A4 portrait;
      margin: 15mm 12mm 14mm 12mm;
      @bottom-center {{
        content: "第 " counter(page) " 頁　共 " counter(pages) " 頁";
        font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
        font-size: 9pt;
      }}
    }}
    * {{ box-sizing: border-box; font-weight: 400 !important; }}
    body {{
      margin: 0;
      color: #000;
      background: #fff;
      font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
      font-size: 11pt;
      line-height: 1.65;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .no-print {{ margin-bottom: 8mm; text-align: right; font-family: system-ui, sans-serif; }}
    .no-print button {{ padding: 5px 14px; border: 1px solid #777; background: #f6f6f6; cursor: pointer; }}
    @media print {{ .no-print {{ display: none; }} }}
    .page {{ width: 186mm; margin: 0 auto; }}
    h1 {{
      margin: 4mm 0 2mm;
      text-align: center;
      font-size: 18pt;
      line-height: 1.6;
      letter-spacing: .04em;
    }}
    .subtitle {{ margin: 0 0 5mm; text-align: center; font-size: 11pt; }}
    .rationale {{
      margin: 0 0 5mm;
      padding: 2.5mm 3mm;
      border: 1px solid #000;
      white-space: pre-wrap;
    }}
    table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
    th, td {{
      border: 1px solid #000;
      padding: 2.2mm 2.4mm;
      text-align: left;
      vertical-align: top;
      white-space: pre-wrap;
      break-inside: avoid;
    }}
    th {{ text-align: center; font-size: 12pt; }}
    .change-tag {{ display: inline-block; margin-bottom: 1mm; }}
    .article-key {{ margin-bottom: 1mm; }}
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  <main class="page">
    <h1>{title}</h1>
    <div class="subtitle">{reg_title}</div>
    {f'<section class="rationale">修正理由：<br>{rationale_html}</section>' if rationale_html else ""}
    <table>
      <thead>
        <tr>
          <th>修正條文</th>
          <th>現行條文</th>
          <th>說明</th>
        </tr>
      </thead>
      <tbody>{table_rows}</tbody>
    </table>
  </main>
</body>
</html>"""
