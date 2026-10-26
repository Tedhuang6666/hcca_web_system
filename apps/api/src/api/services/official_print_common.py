"""共用公文列印格式、字型資源與文字轉換。"""

from __future__ import annotations

import datetime as dt
import html
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.clock import TAIPEI, local_today
from api.models.document import Document
from api.models.org import Org, Position, UserPosition
from api.models.petition import PetitionCase
from api.models.regulation import Regulation

_WEEKDAYS = "一二三四五六日"


_SCHOOL_FULL_NAME = "國立新竹高級中學"


_SCHOOL_SHORT_NAME = "新竹高中"


_DECREE_ISSUER_NAME = f"{_SCHOOL_FULL_NAME}班級聯合自治會"


_BUNDLED_KAI_FONT = "edukai-5.1_20251208.ttf"


_FALLBACK_KAI_FONT = "LXGWWenKaiTC-Regular.ttf"


_BUNDLED_LISHU_FONT = "MoeLI-3.0.ttf"


_BUNDLED_TITLE_FONT = "朝華標題B.ttf"


_BUNDLED_XINGSHU_FONT = "Bakudai-Bold.ttf"


def _bundled_font_candidates(filename: str) -> tuple[Path, ...]:
    """Return deterministic font locations for source and container layouts."""
    locations = [Path("/app/fonts") / filename]
    locations.extend(parent / "fonts" / filename for parent in Path(__file__).resolve().parents)
    locations.extend(parent / filename for parent in Path(__file__).resolve().parents)
    return tuple(dict.fromkeys(locations))


@dataclass(frozen=True)
class _OfficialLine:
    prefix: str
    body: str
    level: int = 0


def _esc(value: object | None) -> str:
    return html.escape(str(value or ""))


def _compact_official_name(value: object | None) -> str:
    """Remove layout whitespace from Chinese official names and headings."""
    return re.sub(r"\s+", "", str(value or "").strip())


def _canonical_official_org_name(*parts: object | None) -> str:
    """Build a school-prefixed official name without redundant org levels."""
    body = "".join(_compact_official_name(part) for part in parts if part)
    while body.startswith(_SCHOOL_FULL_NAME):
        body = body[len(_SCHOOL_FULL_NAME) :]
    while body.startswith(_SCHOOL_SHORT_NAME):
        body = body[len(_SCHOOL_SHORT_NAME) :]
    body = body.replace("班級聯合自治會", "班聯會")
    body = body.replace("班聯會學生會", "班聯會")
    if body.startswith("學生會"):
        body = f"班聯會{body.removeprefix('學生會')}"
    return f"{_SCHOOL_FULL_NAME}{body}"


def _decree_issuer_title(doc: Document, issuer_name: str = "") -> str:
    """Resolve the authority title used by a decree heading and signature."""
    custom_title = _compact_official_name(getattr(doc, "title", ""))
    if custom_title.endswith("令") and custom_title != "法規發布令":
        authority = custom_title[:-1]
        if issuer_name and authority.startswith(issuer_name):
            authority = authority[len(issuer_name) :]
        if authority.startswith(_SCHOOL_FULL_NAME):
            authority = authority[len(_SCHOOL_FULL_NAME) :]
        if authority:
            return authority
    return "主席"


def _font_faces() -> str:
    kai_path = next(
        (
            path
            for filename in (_BUNDLED_KAI_FONT, _FALLBACK_KAI_FONT)
            for path in _bundled_font_candidates(filename)
            if path.is_file()
        ),
        None,
    )
    if kai_path is None:
        return ""
    lishu_path = next(
        (
            path
            for filename in (_BUNDLED_LISHU_FONT, _BUNDLED_KAI_FONT, _FALLBACK_KAI_FONT)
            for path in _bundled_font_candidates(filename)
            if path.is_file()
        ),
        kai_path,
    )
    xingshu_path = next(
        (path for path in _bundled_font_candidates(_BUNDLED_XINGSHU_FONT) if path.is_file()),
        None,
    )
    xingshu_face = (
        f"""
    @font-face {{
      font-family: "OfficialXingshu";
      src: url("{xingshu_path.as_uri()}") format("opentype");
      font-weight: 400;
      font-style: normal;
    }}
    """
        if xingshu_path is not None
        else ""
    )
    title_path = next(
        (path for path in _bundled_font_candidates(_BUNDLED_TITLE_FONT) if path.is_file()),
        None,
    )
    title_face = (
        f"""
    @font-face {{
      font-family: "OfficialTitle";
      src: url("{title_path.as_uri()}") format("truetype");
      font-weight: 400;
      font-style: normal;
    }}
    """
        if title_path is not None
        else ""
    )
    return f"""
    @font-face {{
      font-family: "OfficialKai";
      src: url("{kai_path.as_uri()}") format("truetype");
      font-weight: 400;
      font-style: normal;
    }}
    @font-face {{
      font-family: "OfficialLishu";
      src: url("{lishu_path.as_uri()}") format("truetype");
      font-weight: 400;
      font-style: normal;
    }}
    {xingshu_face}
    {title_face}
    """


def _official_document_title(
    issuer_name: str,
    custom_title: object | None,
    category_label: str,
    org_name: object | None,
) -> str:
    """Render the formal header while preserving an explicit full organization title."""
    title = _compact_official_name(custom_title)
    leaf_name = _compact_official_name(org_name)
    if title and category_label and title.endswith(category_label):
        title_org = title[: -len(category_label)]
        for school_name in (_SCHOOL_FULL_NAME, _SCHOOL_SHORT_NAME):
            if title_org.startswith(school_name):
                title_org = title_org[len(school_name) :]
                break
        canonical_title_org = _canonical_official_org_name(title_org)
        if title_org and (title_org == leaf_name or canonical_title_org == issuer_name):
            return title
    return f"{issuer_name}{category_label}"


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value) or "")


async def _full_org_name(session: AsyncSession, doc: Document | Regulation) -> str:
    """組出發文機關全銜。

    所有公文皆以學校全銜起首，並將班聯會組織樹中的冗餘「學生會」層級省略。
    ``issuer_full_name`` 可覆蓋組織樹名稱，但仍會套用相同的全銜正規化規則。
    """
    explicit = getattr(doc, "issuer_full_name", None)
    if explicit and str(explicit).strip():
        return _canonical_official_org_name(explicit)

    org = getattr(doc, "org", None)
    if org is None:
        return _SCHOOL_FULL_NAME

    names: list[str] = []
    seen: set[object] = set()
    current = org
    while current is not None:
        current_id = getattr(current, "id", None)
        if current_id is not None and current_id in seen:
            break
        if current_id is not None:
            seen.add(current_id)
        names.append(_compact_official_name(getattr(current, "name", "")))
        parent_id = getattr(current, "parent_id", None)
        current = await session.get(Org, parent_id) if parent_id else None

    return _canonical_official_org_name(*reversed(names))


def _roc_date(value: object, *, blank: str = "中華民國　　　年　　月　　日") -> str:
    if value is None:
        return blank
    if isinstance(value, dt.datetime | dt.date):
        return f"中華民國{value.year - 1911}年{value.month}月{value.day}日"
    return _esc(value)


def _roc_datetime(value: object) -> str:
    if value is None:
        return ""
    if not isinstance(value, dt.datetime):
        return _roc_date(value, blank="")
    minute = f"{value.minute:02d}分" if value.minute else ""
    return (
        f"中華民國{value.year - 1911}年{value.month}月{value.day}日"
        f"(星期{_WEEKDAYS[value.weekday()]}){value.hour}時{minute}"
    )


def _join_names(items: list[str]) -> str:
    return "、".join(_esc(item) for item in items if item) or ""


def _recipient_names(doc: Document, recipient_type: str) -> list[str]:
    return [
        r.name
        for r in (doc.recipients or [])
        if _enum_value(getattr(r, "recipient_type", "")) == recipient_type and r.name
    ]


def _attachment_summary(doc: Document, *, has_petition_appendix: bool = False) -> str:
    if not doc.attachments:
        return "陳情案件原文1份" if has_petition_appendix else ""
    names = []
    for attachment in doc.attachments:
        if not getattr(attachment, "filename", None):
            continue
        name = _esc(attachment.display_name or attachment.filename)
        quantity = max(1, int(getattr(attachment, "quantity", 1) or 1))
        names.append(f"{name}{quantity}份")
    if has_petition_appendix:
        names.append("陳情案件原文1份")
    return "、".join(names) or "如附件"


def _petition_appendix_html(case_obj: PetitionCase | None) -> str:
    if case_obj is None:
        return ""
    submitted_at = _roc_date(case_obj.submitted_at, blank="未載明")
    return f"""
  <section class="petition-appendix">
    <header class="petition-appendix-header">
      <p>附件</p>
      <h2>陳情案件原文</h2>
      <div class="petition-appendix-rule"></div>
    </header>
    <table class="petition-appendix-meta">
      <tbody>
        <tr>
          <th>案件案號</th><td>{_esc(case_obj.case_number)}</td>
          <th>提交日期</th><td>{_esc(submitted_at)}</td>
        </tr>
        <tr><th>案件主旨</th><td colspan="3">{_esc(case_obj.title)}</td></tr>
      </tbody>
    </table>
    <section class="petition-original">
      <h3>陳情內容</h3>
      <div>{_esc(case_obj.content)}</div>
    </section>
    <footer>本附件為本案陳情人原始提交內容，隨本公文併送。</footer>
  </section>"""


def _declassification_text(doc: Document) -> str:
    classification = _enum_value(doc.classification)
    condition = _enum_value(getattr(doc, "declassification_condition", "none"))
    expires_at = getattr(doc, "confidentiality_expires_at", None)
    classification_label = {
        "confidential": "密",
        "secret": "機密",
        "highly_confidential": "極機密",
        "absolutely_confidential": "絕對機密",
    }.get(classification, "")
    if classification == "normal":
        return ""
    if condition == "auto_at_date" and expires_at:
        return f"{classification_label}，至{_roc_date(expires_at, blank='')}解密"
    if condition == "manual_approval":
        return f"{classification_label}，經核准後解密"
    return f"{classification_label}，未註明解密條件"


async def _position_title(
    session: AsyncSession,
    *,
    user_id: object,
    org_id: object,
    on_date: dt.date | None = None,
) -> str:
    title_date = on_date or local_today()
    result = await session.execute(
        select(Position.name)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            UserPosition.start_date <= title_date,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= title_date),
            Position.org_id == org_id,
        )
        .order_by(Position.weight.desc())
        .limit(1)
    )
    return _esc(result.scalar_one_or_none())


async def _final_signature_html(
    session: AsyncSession,
    doc: Document,
    *,
    fallback_title: str | None = None,
) -> str:
    approved = [
        approval
        for approval in (doc.approvals or [])
        if _enum_value(getattr(approval, "status", "")) == "approved"
    ]
    if not approved:
        signer = _esc(doc.handler_name)
        title = _esc(fallback_title or doc.handler_unit)
        if not signer:
            return '<section class="signature signature-placeholder">（核准後用印）</section>'
        return (
            '<section class="signature">'
            f'<span class="signature-title">{title}</span>'
            f'<span class="signature-name">{signer}</span>'
            "</section>"
        )

    last = max(approved, key=lambda approval: approval.step_order)
    decided_at = getattr(last, "decided_at", None)
    decision_date = (
        decided_at.astimezone(TAIPEI).date() if isinstance(decided_at, dt.datetime) else None
    )
    if getattr(last, "is_acting", False) and last.delegate and last.approver:
        principal = last.approver
        delegate = last.delegate
        principal_title = (
            await _position_title(
                session,
                user_id=principal.id,
                org_id=doc.org_id,
                on_date=decision_date,
            )
            if getattr(principal, "id", None)
            else ""
        ) or _esc(fallback_title)
        delegate_title = (
            await _position_title(
                session,
                user_id=delegate.id,
                org_id=doc.org_id,
                on_date=decision_date,
            )
            if getattr(delegate, "id", None)
            else ""
        ) or _esc(fallback_title)
        return (
            '<section class="signature signature-acting">'
            f"{_esc(principal.display_name)}({principal_title})假 "
            f"{_esc(delegate.display_name)}({delegate_title})代"
            "</section>"
        )

    actor = last.approver
    signer = _esc(actor.display_name) if actor else ""
    if not signer or not getattr(actor, "id", None):
        return '<section class="signature signature-placeholder">（核准後用印）</section>'
    title = await _position_title(
        session,
        user_id=actor.id,
        org_id=doc.org_id,
        on_date=decision_date,
    )
    title = title or _esc(fallback_title)
    return (
        '<section class="signature">'
        f'<span class="signature-title">{title}</span>'
        f'<span class="signature-name">{signer}</span>'
        "</section>"
    )


_LINE_RE = re.compile(
    r"^(?P<indent>　*)(?P<mark>"
    r"[一二三四五六七八九十百零〇]+、|[（(][一二三四五六七八九十百零〇]+[）)]|"
    r"[０-９0-9]+[、.]|[（(][０-９0-9]+[）)]"
    r")\s*(?P<body>.*)$"
)


def _parse_official_line(raw: str) -> _OfficialLine:
    match = _LINE_RE.match(raw)
    if not match:
        return _OfficialLine("", raw, 0)
    indent = match.group("indent")
    mark = match.group("mark")
    level = max(0, len(indent) // 2)
    return _OfficialLine(indent + mark, match.group("body"), level)


def _hanging_line_html(raw: str) -> str:
    if not raw.strip():
        return '<div class="hanging-line blank-line"></div>'
    parsed = _parse_official_line(raw)
    if parsed.prefix:
        return (
            f'<div class="hanging-line level-{parsed.level}">'
            f'<span class="hanging-prefix">{_esc(parsed.prefix)}</span>'
            f'<span class="hanging-body">{_esc(parsed.body)}</span>'
            "</div>"
        )
    return f'<div class="hanging-line plain-line">{_esc(parsed.body)}</div>'


def _hanging_text(text: str | None) -> str:
    if not text:
        return ""
    return "".join(_hanging_line_html(raw) for raw in text.splitlines())


_AMENDMENT_ROW_RE = re.compile(r"^(\S+)\s{2,}(.+?)\s{2,}(.+)$")


def _amendment_table_html(rows: list[tuple[str, str, str]]) -> str:
    head = (
        "<thead><tr>"
        '<th class="amd-status">異動</th>'
        '<th class="amd-no">條號</th>'
        '<th class="amd-content">內容</th>'
        "</tr></thead>"
    )
    body = "".join(
        "<tr>"
        f'<td class="amd-status">{_esc(status)}</td>'
        f'<td class="amd-no">{_esc(article_no)}</td>'
        f'<td class="amd-content">{_esc(content)}</td>'
        "</tr>"
        for status, article_no, content in rows
    )
    return f'<table class="amendment-table">{head}<tbody>{body}</tbody></table>'


def _render_decree_body(text: str | None) -> str:
    """渲染主令本文，並將「修正條文整理」對照表還原為真正的 HTML 表格。

    主席公布令本文含一段固定寬度 ASCII 對照表（異動／條號／內容）。若以非等寬
    字體逐行直接輸出，欄位會完全錯位無法閱讀，故在此偵測並重建為表格。
    """
    if not text:
        return ""
    lines = text.splitlines()
    total = len(lines)
    chunks: list[str] = []
    index = 0
    while index < total:
        line = lines[index]
        header = lines[index + 1] if index + 1 < total else ""
        rule = lines[index + 2] if index + 2 < total else ""
        if (
            line.strip() == "修正條文整理："
            and all(token in header for token in ("異動", "條號", "內容"))
            and rule.strip().startswith("─")
        ):
            rows: list[tuple[str, str, str]] = []
            cursor = index + 3
            while cursor < total and lines[cursor].strip():
                match = _AMENDMENT_ROW_RE.match(lines[cursor])
                if match is None:
                    break
                rows.append((match.group(1), match.group(2), match.group(3)))
                cursor += 1
            if rows:
                chunks.append(_hanging_line_html(line))
                chunks.append(_amendment_table_html(rows))
                index = cursor
                continue
        chunks.append(_hanging_line_html(line))
        index += 1
    return "".join(chunks)


def _meta_row(label: str, value: str) -> str:
    return (
        '<div class="meta-row">'
        f'<div class="meta-label">{label}</div>'
        f'<div class="meta-value">{value or "&nbsp;"}</div>'
        "</div>"
    )


def _meeting_large_row(label: str, value: str) -> str:
    if not value.strip():
        return ""
    return (
        '<div class="meeting-large-row">'
        f'<div class="large-label">{label}</div>'
        f'<div class="large-value">{value}</div>'
        "</div>"
    )


def _meeting_small_row(label: str, value: str) -> str:
    return (
        '<div class="meeting-small-row">'
        f'<div class="small-label">{label}</div>'
        f'<div class="small-value">{value or "&nbsp;"}</div>'
        "</div>"
    )


def _document_section(label: str, value: str | None) -> str:
    if not value or not value.strip():
        return ""
    return (
        '<section class="doc-section">'
        f'<div class="doc-section-label">{label}</div>'
        f'<div class="doc-section-body">{_hanging_text(value)}</div>'
        "</section>"
    )


def _subject_section(value: str | None) -> str:
    if not value or not value.strip():
        return ""
    return (
        '<section class="subject-section">'
        '<div class="subject-label">主旨：</div>'
        f'<div class="subject-body">{_esc(value)}</div>'
        "</section>"
    )
