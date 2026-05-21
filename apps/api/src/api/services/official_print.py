"""Official print HTML templates for documents and regulations."""

from __future__ import annotations

import datetime as dt
import html
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document
from api.models.org import Position, UserPosition
from api.models.regulation import Regulation
from api.models.user import User

_CN_DIGITS = "零一二三四五六七八九"
_WEEKDAYS = "一二三四五六日"
_SCHOOL_FULL_NAME = "國立新竹高級中學"
_KAI_FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/hcca/STKAITI.TTF"),
    Path("/mnt/c/Windows/Fonts/STKAITI.TTF"),
)
_SERIF_FONT_CANDIDATES = (
    Path("/usr/share/fonts/opentype/noto-custom/NotoSerifCJKtc-Regular.otf"),
    Path("/mnt/c/Windows/Fonts/NotoSerifCJKtc-Regular.otf"),
)
_HAND_FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/hcca/SIMLI.TTF"),
    Path("/mnt/c/Windows/Fonts/SIMLI.TTF"),
    Path("/usr/share/fonts/truetype/hcca/STKAITI.TTF"),
    Path("/mnt/c/Windows/Fonts/STKAITI.TTF"),
)


@dataclass(frozen=True)
class _OfficialLine:
    prefix: str
    body: str
    level: int = 0


def _esc(value: object | None) -> str:
    return html.escape(str(value or ""))


def _font_faces() -> str:
    faces: list[str] = []
    kai_path = next((path for path in _KAI_FONT_CANDIDATES if path.exists()), None)
    serif_path = next((path for path in _SERIF_FONT_CANDIDATES if path.exists()), None)
    hand_path = next((path for path in _HAND_FONT_CANDIDATES if path.exists()), None)
    if kai_path is not None:
        faces.append(
            f"""
    @font-face {{
      font-family: "OfficialKai";
      src: url("{kai_path.as_uri()}") format("truetype");
      font-weight: 400;
      font-style: normal;
    }}
    """
        )
    if serif_path is not None:
        faces.append(
            f"""
    @font-face {{
      font-family: "OfficialSerifTC";
      src: url("{serif_path.as_uri()}") format("opentype");
      font-weight: 400;
      font-style: normal;
    }}
    """
        )
    if hand_path is not None:
        faces.append(
            f"""
    @font-face {{
      font-family: "OfficialHand";
      src: url("{hand_path.as_uri()}") format("truetype");
      font-weight: 400;
      font-style: normal;
    }}
    """
        )
    return "".join(faces)


def render_print_pdf(html_content: str) -> bytes:
    """Render official print HTML to PDF bytes."""
    from weasyprint import HTML

    return HTML(string=html_content, base_url="/").write_pdf()


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value) or "")


def _full_org_name(doc: Document | Regulation) -> str:
    raw = getattr(doc, "issuer_full_name", None) or (doc.org.name if doc.org else "")
    name = str(raw or "").strip()
    if not name:
        return ""
    if name.startswith(_SCHOOL_FULL_NAME):
        return name
    return f"{_SCHOOL_FULL_NAME}{name}"


def _br(value: str | None) -> str:
    return _esc(value).replace("\n", "<br>")


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


def _join_names(items: list[str]) -> str:
    return "、".join(_esc(item) for item in items if item) or ""


def _recipient_names(doc: Document, recipient_type: str) -> list[str]:
    return [
        r.name
        for r in (doc.recipients or [])
        if _enum_value(getattr(r, "recipient_type", "")) == recipient_type and r.name
    ]


def _attachment_summary(doc: Document) -> str:
    if not doc.attachments:
        return ""
    names = [a.display_name or a.filename for a in doc.attachments if getattr(a, "filename", None)]
    return "、".join(_esc(name) for name in names) or "如附件"


def _declassification_text(doc: Document) -> str:
    classification = _enum_value(doc.classification)
    condition = _enum_value(getattr(doc, "declassification_condition", "none"))
    expires_at = getattr(doc, "confidentiality_expires_at", None)
    if classification == "normal":
        return ""
    if condition == "auto_at_date" and expires_at:
        return f"至{_roc_date(expires_at, blank='')}解密"
    if condition == "manual_approval":
        return "經核准後解密"
    return "一般"


def _viewer_is_recipient(doc: Document, viewer: User | None) -> bool:
    if viewer is None:
        return False
    user_tokens = {
        str(getattr(viewer, "display_name", "") or "").strip().lower(),
        str(getattr(viewer, "email", "") or "").strip().lower(),
    }
    user_tokens.discard("")
    if not user_tokens:
        return False
    for recipient in doc.recipients or []:
        rec_tokens = {
            str(getattr(recipient, "name", "") or "").strip().lower(),
            str(getattr(recipient, "email", "") or "").strip().lower(),
        }
        rec_tokens.discard("")
        if user_tokens.intersection(rec_tokens):
            return True
        if any(user in rec or rec in user for user in user_tokens for rec in rec_tokens):
            return True
    return False


async def _position_title(
    session: AsyncSession,
    *,
    user_id: object,
    org_id: object,
) -> str:
    today = dt.date.today()
    result = await session.execute(
        select(Position.name)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(
            UserPosition.user_id == user_id,
            UserPosition.start_date <= today,
            or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
            Position.org_id == org_id,
        )
        .order_by(Position.weight.desc())
        .limit(1)
    )
    return _esc(result.scalar_one_or_none())


async def _final_signature_html(session: AsyncSession, doc: Document) -> str:
    approved = [
        approval
        for approval in (doc.approvals or [])
        if _enum_value(getattr(approval, "status", "")) == "approved"
    ]
    if not approved:
        signer = _esc(doc.handler_name)
        title = _esc(doc.handler_unit)
        if not signer:
            return '<section class="signature signature-placeholder">（核准後用印）</section>'
        return (
            '<section class="signature">'
            f'<span class="signature-title">{title}</span>'
            f'<span class="signature-name">{signer}</span>'
            "</section>"
        )

    last = max(approved, key=lambda approval: approval.step_order)
    if getattr(last, "is_acting", False) and last.delegate and last.approver:
        principal = last.approver
        delegate = last.delegate
        principal_title = (
            await _position_title(session, user_id=principal.id, org_id=doc.org_id)
            if getattr(principal, "id", None)
            else ""
        )
        delegate_title = (
            await _position_title(session, user_id=delegate.id, org_id=doc.org_id)
            if getattr(delegate, "id", None)
            else ""
        )
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
    title = await _position_title(session, user_id=actor.id, org_id=doc.org_id)
    return (
        '<section class="signature">'
        f'<span class="signature-title">{title}</span>'
        f'<span class="signature-name">{signer}</span>'
        "</section>"
    )


_LINE_RE = re.compile(
    r"^(?P<indent>　*)(?P<mark>[一二三四五六七八九十百零〇]+、|（[一二三四五六七八九十百零〇]+）|\d+\.|\(\d+\))\s*(?P<body>.*)$"
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


async def render_document_print_html(
    session: AsyncSession,
    doc: Document,
    viewer: User | None = None,
) -> str:
    """Render a ROC-style official document or meeting notice print page."""
    cat = _enum_value(doc.category)
    is_meeting = cat == "meeting_notice"
    is_decree = cat == "decree"
    is_record = cat == "record"
    issuer = _esc(_full_org_name(doc))
    category_label = {
        "letter": "函",
        "decree": "令",
        "announcement": "公告",
        "report": "報告",
        "record": "紀錄",
        "consultation": "咨",
        "meeting_notice": "開會通知單",
        "other": "書函",
    }.get(cat, "函")
    urgency = {
        "normal": "普通件",
        "priority": "速件",
        "express": "最速件",
    }.get(_enum_value(doc.urgency), "普通件")
    classification = {
        "normal": "",
        "confidential": "密",
        "secret": "機密",
    }.get(_enum_value(doc.classification), "")

    main_recipients = _recipient_names(doc, "main")
    primary_recipients = _recipient_names(doc, "primary")
    copy_recipients = _recipient_names(doc, "copy")
    recipient_text = _join_names(main_recipients or primary_recipients)
    addressed_to = recipient_text or "（未填）"
    attachment_summary = _attachment_summary(doc)
    issue_date = _roc_date(doc.issued_at or doc.completed_at or doc.created_at)
    serial = _esc(doc.serial_number)
    file_number = _esc(getattr(doc, "file_number", "") or "")
    retention_period = _esc(getattr(doc, "retention_period", "") or "")
    declassification = _declassification_text(doc)
    copy_mark = "正本" if _viewer_is_recipient(doc, viewer) else "影本"

    handler_block = ""
    if doc.handler_name:
        handler_block += f"<div>承辦人：{_esc(doc.handler_name)}</div>"
    if doc.handler_email:
        handler_block += f"<div>電子信箱：{_esc(doc.handler_email)}</div>"

    signature = await _final_signature_html(session, doc)

    meta_rows = [
        _meta_row("發文日期：", issue_date),
        _meta_row("發文字號：", serial),
        _meta_row("速別：", urgency),
        _meta_row("密等及解密條件或保密期限：", declassification or classification),
        _meta_row("附件：", attachment_summary),
    ]

    if is_meeting:
        meeting_body = "".join(
            [
                _meeting_large_row("受文者：", addressed_to),
                _meeting_small_row("發文日期：", issue_date),
                _meeting_small_row("發文字號：", serial),
                _meeting_small_row("速別：", urgency),
                _meeting_small_row(
                    "密等及解密條件或保密期限：", declassification or classification
                ),
                _meeting_small_row("附件：", attachment_summary),
                _meeting_large_row("開會事由：", _esc(doc.meeting_purpose or doc.subject or "")),
                _meeting_large_row("開會時間：", _esc(_roc_datetime(doc.meeting_time))),
                _meeting_large_row("開會地點：", _esc(doc.meeting_location or "")),
                _meeting_large_row("主持人：", _esc(doc.meeting_chairperson or "")),
                _meeting_large_row("聯絡人：", _esc(doc.handler_name or "")),
                _meeting_small_row("出席者：", _join_names(primary_recipients)),
                _meeting_small_row("列席者：", _join_names(copy_recipients)),
                _meeting_small_row("副本：", ""),
            ]
        )
        if doc.action_required:
            meeting_body += '<div class="meeting-note-label">附註：</div>'
            meeting_body += (
                f'<div class="meeting-note-body">{_hanging_text(doc.action_required)}</div>'
            )
        if doc.doc_description:
            meeting_body += '<div class="agenda-title">議事日程：</div>'
            meeting_body += f'<div class="agenda-body">{_hanging_text(doc.doc_description)}</div>'
        if issuer:
            meeting_body += f'<section class="meeting-seal">{issuer}</section>'
        body_html = meeting_body
    elif is_decree:
        decree_body_text = doc.doc_description or doc.content or doc.action_required or doc.subject
        decree_rows = [
            _meta_row("發文字號：", serial),
            _meta_row("發文日期：", issue_date),
        ]
        if recipient_text:
            decree_rows.append(_meta_row("受文者：", recipient_text))
        if attachment_summary:
            decree_rows.append(_meta_row("附件：", attachment_summary))
        body_html = (
            f'<section class="decree-meta">{"".join(decree_rows)}</section>'
            f'<section class="decree-body">{_render_decree_body(decree_body_text)}</section>'
            f"{signature}"
        )
    elif is_record:
        body_html = (
            f'<section class="recipient-line">時間：{_esc(_roc_datetime(doc.meeting_time))}</section>'
            f'<section class="meta">'
            f"{_meta_row('地點：', _esc(doc.meeting_location or ''))}"
            f"{_meta_row('主席：', _esc(doc.meeting_chairperson or ''))}"
            f"{_meta_row('記錄者：', _esc(doc.handler_name or ''))}"
            f"{_meta_row('出席者：', _join_names(primary_recipients or main_recipients))}"
            f"{_meta_row('列席者：', _join_names(copy_recipients))}"
            f"{_meta_row('附件：', attachment_summary)}"
            f"</section>"
            f"{_document_section('討論事項：', doc.doc_description)}"
            f"{_document_section('決議：', doc.action_required)}"
            f"{signature}"
        )
    else:
        description_label = "公告事項：" if cat == "announcement" else "說明："
        action_label = {
            "report": "建議事項：",
            "consultation": "辦法或事項：",
        }.get(cat, "辦法：")
        body_html = (
            f'<section class="recipient-line">受文者：{addressed_to}</section>'
            f'<section class="meta">{"".join(meta_rows)}</section>'
            f"{_subject_section(doc.subject)}"
            f"{_document_section(description_label, doc.doc_description)}"
            f"{_document_section(action_label, doc.action_required)}"
        )
        if not (doc.subject or doc.doc_description or doc.action_required) and doc.content:
            body_html += _document_section("說明：", doc.content)
        body_html += (
            '<section class="copies">'
            f"<div>正本：{_join_names(primary_recipients) or addressed_to}</div>"
            f"<div>副本：{_join_names(copy_recipients)}</div>"
            "</section>"
            f"{signature}"
        )

    title_gap = " meeting-title" if is_meeting else ""
    right_title = f'<span class="doc-type{title_gap}">{category_label}</span>'

    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>{_esc(doc.title)}</title>
  <style>
    {_font_faces()}
    @page {{
      size: A4 portrait;
      margin: 16mm 19mm 17mm 19mm;
      @bottom-center {{
        content: "第 " counter(page) " 頁　共 " counter(pages) " 頁";
        font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
        font-size: 10pt;
      }}
    }}
    * {{ box-sizing: border-box; font-weight: 400 !important; }}
    body {{
      margin: 0;
      background: #fff;
      color: #000;
      font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
      font-size: 14pt;
      line-height: 1.75;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .no-print {{ margin: 0 0 7mm; text-align: right; font-family: system-ui, sans-serif; }}
    .no-print button {{ padding: 5px 14px; border: 1px solid #777; background: #f6f6f6; cursor: pointer; }}
    @media print {{ .no-print {{ display: none; }} }}
    .page {{
      position: relative;
      width: 172mm;
      min-height: 244mm;
      margin: 0 auto;
      padding-left: 18mm;
    }}
    .binding {{
      position: fixed;
      left: 10mm;
      top: 16mm;
      bottom: 17mm;
      width: 5mm;
      border-left: 1px dotted #777;
      color: #000;
      font-size: 10pt;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      padding-top: 54mm;
      padding-bottom: 42mm;
      z-index: 0;
    }}
    .binding span {{ transform: translateX(-2.5mm); }}
    .copy-mark {{ font-size: 14pt; letter-spacing: .55em; margin-left: 2mm; }}
    .delivery {{ font-size: 10.5pt; margin: 1mm 0 6mm 2mm; }}
    .file-box {{
      position: absolute;
      right: 0;
      top: 0;
      font-size: 10.5pt;
      line-height: 2.1;
      min-width: 54mm;
    }}
    .title {{
      text-align: center;
      font-size: 20pt;
      letter-spacing: .08em;
      margin-top: 2mm;
      margin-bottom: 14mm;
      white-space: normal;
    }}
    .doc-type {{
      display: inline-block;
      margin-left: 12mm;
      letter-spacing: .35em;
    }}
    .meeting-title {{ margin-left: 9mm; letter-spacing: .15em; }}
    .handler {{
      position: absolute;
      right: 8mm;
      top: 42mm;
      width: 62mm;
      font-size: 10.5pt;
      line-height: 1.35;
      text-align: left;
    }}
    .recipient-line {{
      margin-top: 2mm;
      margin-bottom: 3mm;
      font-size: 15pt;
      line-height: 1.8;
    }}
    .meta {{ margin: 0 0 7mm; }}
    .meta-row,
    .meeting-small-row {{
      display: flex;
      align-items: baseline;
      min-height: 5.2mm;
      font-size: 11pt;
      line-height: 1.55;
    }}
    .meta-label,
    .small-label {{ flex: 0 0 auto; white-space: nowrap; margin-right: .7mm; }}
    .meta-value,
    .small-value {{ flex: 1 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }}
    .meeting-large-row {{
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      column-gap: 2mm;
      margin: 2.1mm 0;
      font-size: 15pt;
      line-height: 1.55;
    }}
    .large-label {{ white-space: nowrap; }}
    .large-value {{ min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }}
    .subject-section {{
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      column-gap: .45em;
      margin: 5mm 0;
      font-size: 15pt;
      line-height: 1.9;
      break-inside: avoid;
    }}
    .subject-label {{ white-space: nowrap; }}
    .subject-body {{ min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }}
    .doc-section {{ margin: 5mm 0; break-inside: avoid; }}
    .doc-section-label {{
      font-size: 15pt;
      line-height: 1.75;
    }}
    .doc-section-body {{
      margin-top: 1mm;
      padding-left: 16mm;
      font-size: 15pt;
      line-height: 1.9;
    }}
    .decree-meta {{
      margin: 0 0 10mm;
      font-size: 12pt;
      line-height: 1.65;
    }}
    .decree-body {{
      margin: 8mm 0 0;
      font-size: 15pt;
      line-height: 1.9;
      white-space: normal;
    }}
    .amendment-table {{
      width: 100%;
      border-collapse: collapse;
      margin: 3mm 0 5mm;
      font-size: 12pt;
      line-height: 1.6;
      break-inside: auto;
    }}
    .amendment-table th,
    .amendment-table td {{
      border: 1px solid #000;
      padding: 1.6mm 2.2mm;
      text-align: left;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .amendment-table .amd-status {{ width: 16mm; white-space: nowrap; }}
    .amendment-table .amd-no {{ width: 26mm; white-space: nowrap; }}
    .hanging-line {{
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      column-gap: .45em;
      margin: .2mm 0;
      break-inside: avoid;
    }}
    .hanging-line.plain-line {{
      display: block;
      min-width: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }}
    .hanging-prefix {{ white-space: pre; }}
    .hanging-body {{ min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }}
    .level-1 {{ margin-left: 0; }}
    .level-2 {{ margin-left: 2em; }}
    .level-3 {{ margin-left: 4em; }}
    .blank-line {{ height: 1em; }}
    .agenda-title,
    .meeting-note-label {{ margin-top: 5mm; font-size: 15pt; }}
    .agenda-body,
    .meeting-note-body {{
      margin-top: 1mm;
      padding-left: 8mm;
      font-size: 15pt;
      line-height: 1.65;
    }}
    .copies {{ margin-top: 8mm; font-size: 11pt; line-height: 1.55; }}
    .signature {{
      margin-top: 10mm;
      color: #003aa7;
      font-family: "OfficialHand","OfficialKai","OfficialSerifTC","LiSu","STLiti",cursive;
      font-size: 26pt;
      letter-spacing: .12em;
      text-shadow: .35px 0 #003aa7, 0 .35px #003aa7;
    }}
    .meeting-seal {{
      color: #003aa7;
      font-family: "OfficialHand","OfficialKai","OfficialSerifTC","LiSu","STLiti",cursive;
      font-size: 28pt;
      line-height: 1.7;
      letter-spacing: .16em;
      text-shadow: .35px 0 #003aa7, 0 .35px #003aa7;
    }}
    .signature-title {{ display: inline-block; font-size: 24pt; margin-right: 6mm; }}
    .signature-name {{ display: inline-block; font-size: 48pt; }}
    .signature-acting {{
      display: block;
      font-size: 24pt;
      line-height: 1.6;
      white-space: nowrap;
    }}
    .signature-placeholder {{ color: #777; font-size: 12pt; }}
    .meeting-seal {{ margin-top: 5mm; }}
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  <div class="binding"><span>裝</span><span>訂</span><span>線</span></div>
  <main class="page">
    <div class="copy-mark">{copy_mark}</div>
    <div class="delivery">發文方式：線上寄送</div>
    <div class="file-box">檔　　號：{file_number}<br>保存年限：{retention_period}</div>
    <header class="title"><span>{issuer}</span>{right_title}</header>
    {f'<aside class="handler">{handler_block}</aside>' if handler_block and not is_meeting else ""}
    <section class="body">{body_html}</section>
  </main>
</body>
</html>"""


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
    revision_rows = _law_revision_rows(reg)
    if revision_rows:
        rows.append(revision_rows)
    return "".join(rows)


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
    for article in articles:
        article_type = _enum_value(article.article_type)
        if article_type == "clause":
            article_type = "article"
        elif article_type == "subsection":
            article_type = "subparagraph"
        content = _br(article.content or "")
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
            chunks.append(
                _article_html(f"第{_law_number(article.legal_number, counters['article'])}條", body)
            )
        elif article_type == "paragraph":
            counters["paragraph"] += 1
            counters["subparagraph"] = counters["item"] = 0
            chunks.append(
                _nested_article_html(
                    f"第{_law_number(article.legal_number, counters['paragraph'])}項",
                    body,
                    cls="paragraph-row",
                )
            )
        elif article_type == "subparagraph":
            counters["subparagraph"] += 1
            counters["item"] = 0
            chunks.append(
                _nested_article_html(
                    f"{_law_number(article.legal_number, counters['subparagraph'])}、",
                    body,
                    cls="subparagraph-row",
                )
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
    title = _esc(reg.title)
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
      size: A4 portrait;
      margin: 20mm 24mm 18mm 24mm;
      @bottom-center {{
        content: "第 " counter(page) " 頁　共 " counter(pages) " 頁";
        font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
        font-size: 10pt;
      }}
    }}
    * {{ box-sizing: border-box; font-weight: 400 !important; }}
    body {{
      margin: 0;
      color: #000;
      background: #fff;
      font-family: "OfficialKai","OfficialSerifTC","標楷體","DFKai-SB",serif;
      font-size: 12pt;
      line-height: 1.8;
      overflow-wrap: anywhere;
      word-break: break-word;
    }}
    .no-print {{ margin-bottom: 8mm; text-align: right; font-family: system-ui, sans-serif; }}
    .no-print button {{ padding: 5px 14px; border: 1px solid #777; background: #f6f6f6; cursor: pointer; }}
    @media print {{ .no-print {{ display: none; }} }}
    .law-page {{
      width: 164mm;
      min-height: 246mm;
      margin: 0 auto;
    }}
    .law-title {{
      text-align: center;
      font-size: 20pt;
      line-height: 1.75;
      margin: 12mm 0 4mm;
      letter-spacing: .08em;
    }}
    .legislative-history {{
      width: 74mm;
      margin: 0 0 13mm auto;
      font-size: 12pt;
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
      column-gap: 13mm;
      break-inside: avoid;
    }}
    .chapter-row {{
      margin: 9mm 0 5mm;
      font-size: 14pt;
    }}
    .article-row {{
      margin: 3.3mm 0;
    }}
    .article-label {{ white-space: nowrap; }}
    .article-body {{
      min-width: 0;
      white-space: pre-wrap;
      text-align: justify;
      overflow-wrap: anywhere;
    }}
    .nested-article-row {{
      margin-top: 1.4mm;
      margin-bottom: 1.4mm;
      text-align: justify;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      break-inside: avoid;
    }}
    .paragraph-row {{ margin-left: 38mm; }}
    .subparagraph-row {{ margin-left: 46mm; }}
    .item-row {{ margin-left: 54mm; }}
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
      <div>{title}</div>
    </header>
    {f'<section class="legislative-history">{history}</section>' if history else ""}
    {preface}
    <section class="articles">{articles}</section>
  </main>
</body>
</html>"""
