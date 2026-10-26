"""正式公文列印 HTML renderer。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.document import Document
from api.models.petition import PetitionCase
from api.models.user import User
from api.services.official_print_common import (
    _DECREE_ISSUER_NAME,
    _attachment_summary,
    _compact_official_name,
    _declassification_text,
    _decree_issuer_title,
    _document_section,
    _enum_value,
    _esc,
    _final_signature_html,
    _font_faces,
    _full_org_name,
    _hanging_text,
    _join_names,
    _meeting_large_row,
    _meeting_small_row,
    _meta_row,
    _official_document_title,
    _petition_appendix_html,
    _recipient_names,
    _render_decree_body,
    _roc_date,
    _roc_datetime,
    _subject_section,
)


async def render_document_print_html(
    session: AsyncSession,
    doc: Document,
    viewer: User | None = None,
    *,
    copy_mark_override: str | None = None,
    addressed_recipient_name: str | None = None,
) -> str:
    """Render a ROC-style official document or meeting notice print page.

    - ``copy_mark_override``：呼叫端決定後傳入「正本」或「影本」。
    - ``addressed_recipient_name``：管理員指定列印某筆受文者版本時，
      在「受文者」欄位顯示該名稱（覆蓋預設彙整文字）。
    """
    cat = _enum_value(doc.category)
    is_notice = cat in {"meeting_notice", "inspection_notice"}
    is_decree = cat == "decree"
    is_record = cat == "record"
    is_consultation = cat == "consultation"
    # 主席令由班級聯合自治會發布，不把主席職位組織併入機關全銜。
    issuer_name = _DECREE_ISSUER_NAME if is_decree else await _full_org_name(session, doc)
    decree_authority_title = _decree_issuer_title(doc, issuer_name) if is_decree else ""
    issuer = _esc(issuer_name)
    category_label = {
        "letter": "函",
        "decree": "令",
        "announcement": "公告",
        "presentation": "呈",
        "report": "報告",
        "record": "紀錄",
        "consultation": "咨",
        "meeting_notice": "開會通知單",
        "inspection_notice": "會勘通知單",
        "phone_record": "公務電話紀錄",
        "book_letter": "書函",
        "directive": "手令",
        "signature": "簽",
        "memo": "便簽",
        "appointment": "聘書",
        "certificate": "證明書",
        "license": "證書",
        "contract": "契約書",
        "proposal": "提案",
        "summary": "節略",
        "briefing": "說帖",
        "form": "表單",
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
        "highly_confidential": "極機密",
        "absolutely_confidential": "絕對機密",
    }.get(_enum_value(doc.classification), "")

    main_recipients = _recipient_names(doc, "main")
    primary_recipients = _recipient_names(doc, "primary")
    attendee_recipients = _recipient_names(doc, "attendee")
    observer_recipients = _recipient_names(doc, "observer")
    copy_recipients = _recipient_names(doc, "copy")
    recipient_text = addressed_recipient_name or _join_names(main_recipients or primary_recipients)
    addressed_to = recipient_text or "（未填）"
    petition_case_id = getattr(doc, "petition_case_id", None)
    petition_case = await session.get(PetitionCase, petition_case_id) if petition_case_id else None
    attachment_summary = _attachment_summary(doc, has_petition_appendix=petition_case is not None)
    petition_appendix = _petition_appendix_html(petition_case)
    issue_date = _roc_date(doc.issued_at or doc.completed_at or doc.created_at)
    serial = _esc(doc.serial_number)
    if str(doc.serial_number).startswith("DRAFT-"):
        serial = "（草稿，待正式發文）"
    file_number = _esc(getattr(doc, "file_number", "") or "")
    retention_period = _esc(getattr(doc, "retention_period", "") or "")
    classification_number = _esc(getattr(doc, "classification_number", "") or "")
    source_document_date = _roc_date(getattr(doc, "source_document_date", None), blank="")
    source_document_number = _esc(getattr(doc, "source_document_number", "") or "")
    declassification = _declassification_text(doc)
    copy_mark = copy_mark_override or "影本"

    handler_block = ""
    if doc.handler_name:
        handler_block += f"<div>承辦人：{_esc(doc.handler_name)}</div>"
    if doc.handler_email:
        handler_block += f"<div>電子信箱：{_esc(doc.handler_email)}</div>"
    handler_phone = getattr(doc, "handler_phone", None)
    if handler_phone:
        handler_block += f"<div>電話：{_esc(handler_phone)}</div>"

    issuer_contact = ""
    if getattr(doc, "issuer_postal_code", None) or getattr(doc, "issuer_address", None):
        issuer_contact = (
            f"<div>{_esc(getattr(doc, 'issuer_postal_code', '') or '')} "
            f"{_esc(getattr(doc, 'issuer_address', '') or '')}</div>"
        )

    signature_fallback_title = (
        decree_authority_title
        if is_decree
        else "主席"
        if is_consultation and not getattr(doc, "handler_unit", None)
        else None
    )
    signature = await _final_signature_html(
        session,
        doc,
        fallback_title=signature_fallback_title,
    )

    meta_rows = [
        _meta_row("發文日期：", issue_date),
        _meta_row("發文字號：", serial),
        _meta_row("速別：", urgency),
        _meta_row("密等及解密條件或保密期限：", declassification or classification),
        _meta_row("附件：", attachment_summary),
    ]
    if file_number or retention_period:
        meta_rows.append(_meta_row("檔號／保存年限：", f"{file_number}／{retention_period}"))
    if classification_number:
        meta_rows.append(_meta_row("分類號：", classification_number))
    if source_document_date or source_document_number:
        meta_rows.append(
            _meta_row(
                "收文日期字號：",
                "　".join(
                    value for value in (source_document_date, source_document_number) if value
                ),
            )
        )

    if is_notice:
        notice_word = "開會" if cat == "meeting_notice" else "會勘"
        notice_rows = [
            _meeting_large_row("受文者：", addressed_to),
            _meeting_small_row("發文日期：", issue_date),
            _meeting_small_row("發文字號：", serial),
            _meeting_small_row("速別：", urgency),
            _meeting_small_row("密等及解密條件或保密期限：", declassification or classification),
            _meeting_small_row("附件：", attachment_summary),
        ]
        if file_number or retention_period:
            notice_rows.append(
                _meeting_small_row("檔號／保存年限：", f"{file_number}／{retention_period}")
            )
        if classification_number:
            notice_rows.append(_meeting_small_row("分類號：", classification_number))
        if source_document_date or source_document_number:
            notice_rows.append(
                _meeting_small_row(
                    "收文日期字號：",
                    "　".join(
                        value for value in (source_document_date, source_document_number) if value
                    ),
                )
            )
        notice_rows.extend(
            [
                _meeting_large_row(
                    f"{notice_word}事由：", _esc(doc.meeting_purpose or doc.subject or "")
                ),
                _meeting_large_row(f"{notice_word}時間：", _esc(_roc_datetime(doc.meeting_time))),
                _meeting_large_row(f"{notice_word}地點：", _esc(doc.meeting_location or "")),
                _meeting_large_row("主持人：", _esc(doc.meeting_chairperson or "")),
                _meeting_large_row(
                    "聯絡人及電話：",
                    _esc("、".join(value for value in (doc.handler_name, handler_phone) if value)),
                ),
                _meeting_small_row(
                    "出席者：",
                    _join_names(attendee_recipients or primary_recipients),
                ),
                _meeting_small_row(
                    "列席者：",
                    _join_names(observer_recipients or copy_recipients),
                ),
                _meeting_small_row(
                    "副本：", _join_names(copy_recipients) if observer_recipients else ""
                ),
            ]
        )
        meeting_body = "".join(notice_rows)
        if doc.action_required:
            meeting_body += '<div class="meeting-note-label">附註：</div>'
            meeting_body += (
                f'<div class="meeting-note-body">{_hanging_text(doc.action_required)}</div>'
            )
        if doc.doc_description:
            meeting_body += '<div class="agenda-title">議事日程：</div>'
            meeting_body += f'<div class="agenda-body">{_hanging_text(doc.doc_description)}</div>'
        if issuer:
            seal_font_size = min(30.0, max(16.0, 410 / max(len(issuer), 1)))
            meeting_body += (
                f'<section class="meeting-seal" style="font-size:{seal_font_size:.1f}pt">'
                f"{issuer}</section>"
            )
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
            f"{_meta_row('出席者：', _join_names(attendee_recipients or primary_recipients or main_recipients))}"
            f"{_meta_row('列席者：', _join_names(observer_recipients or copy_recipients))}"
            f"{_meta_row('附件：', attachment_summary)}"
            f"</section>"
            f"{_document_section('討論事項：', doc.doc_description)}"
            f"{_document_section('決議：', doc.action_required)}"
            f"{signature}"
        )
    elif is_consultation:
        consultation_meta_rows = [
            _meta_row("發文字號：", serial),
            _meta_row("速別：", urgency),
            _meta_row("密等及解密條件或保密期限：", declassification or classification),
            _meta_row("附件：", attachment_summary),
        ]
        if file_number or retention_period:
            consultation_meta_rows.append(
                _meta_row("檔號／保存年限：", f"{file_number}／{retention_period}")
            )
        if classification_number:
            consultation_meta_rows.append(_meta_row("分類號：", classification_number))
        if source_document_date or source_document_number:
            consultation_meta_rows.append(
                _meta_row(
                    "收文日期字號：",
                    "　".join(
                        value for value in (source_document_date, source_document_number) if value
                    ),
                )
            )
        consultation_body = "".join(
            (
                _subject_section(doc.subject),
                _document_section("依據：", getattr(doc, "basis", None)),
                _document_section("說明：", doc.doc_description or doc.content),
                _document_section("辦法或事項：", doc.action_required),
            )
        )
        body_html = (
            f'<section class="consultation-recipient">受文者：{addressed_to}</section>'
            f'<section class="meta consultation-meta">{"".join(consultation_meta_rows)}</section>'
            f'<section class="consultation-content">{consultation_body}</section>'
            '<div class="consultation-closing">此咨</div>'
            f'<div class="consultation-final-recipient">{addressed_to}</div>'
            '<section class="copies consultation-copies">'
            f"<div>正本：{_join_names(primary_recipients) or addressed_to}</div>"
            f"<div>副本：{_join_names(copy_recipients)}</div>"
            "</section>"
            f"{signature}"
            f'<div class="consultation-date">{issue_date}</div>'
        )
    else:
        description_label = "公告事項：" if cat == "announcement" else "說明："
        action_label = {
            "report": "建議事項：",
            "signature": "擬辦：",
        }.get(cat, "辦法：")
        body_html = (
            f'<section class="recipient-line">受文者：{addressed_to}</section>'
            f'<section class="meta">{"".join(meta_rows)}</section>'
            f"{_subject_section(doc.subject)}"
            f"{_document_section('依據：', getattr(doc, 'basis', None))}"
            f"{_document_section(description_label, doc.doc_description)}"
        )
        if not (doc.subject or doc.doc_description or doc.action_required) and doc.content:
            body_html += _document_section("說明：", doc.content)
        closing_html = (
            f"{_document_section(action_label, doc.action_required)}"
            '<section class="copies">'
            f"<div>正本：{_join_names(primary_recipients) or addressed_to}</div>"
            f"<div>副本：{_join_names(copy_recipients)}</div>"
            "</section>"
            f"{signature}"
        )
        body_html += f'<section class="document-closing">{closing_html}</section>'

    custom_title = _compact_official_name(getattr(doc, "title", ""))
    if is_decree:
        if custom_title.startswith(issuer_name) and custom_title.endswith("令"):
            document_title = custom_title
        else:
            document_title = f"{issuer_name}{decree_authority_title}令"
    else:
        document_title = _official_document_title(
            issuer_name,
            custom_title,
            category_label,
            getattr(getattr(doc, "org", None), "name", None),
        )
    title_font_size = min(20.0, max(10.0, 440 / max(len(document_title), 1)))
    document_title = _esc(document_title)
    page_class = " consultation-page" if is_consultation else ""

    return f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>{_esc(doc.title)}</title>
  <style>
    {_font_faces()}
    @page {{
      size: A4 portrait;
      margin: 25mm;
      @bottom-center {{
        content: "第 " counter(page) " 頁　共 " counter(pages) " 頁";
        font-family: "Times New Roman","OfficialKai","標楷體","DFKai-SB",serif;
        font-size: 10pt;
      }}
    }}
    * {{ box-sizing: border-box; font-weight: 400 !important; }}
    body {{
      margin: 0;
      background: #fff;
      color: #000;
      font-family: "Times New Roman","OfficialKai","標楷體","DFKai-SB",serif;
      font-size: 12pt;
      line-height: 1.25;
      overflow-wrap: anywhere;
      word-break: normal;
    }}
    .no-print {{ margin: 0 0 7mm; text-align: right; font-family: system-ui, sans-serif; }}
    .no-print button {{ padding: 5px 14px; border: 1px solid #777; background: #f6f6f6; cursor: pointer; }}
    @media print {{ .no-print {{ display: none; }} }}
    .page {{
      position: relative;
      width: 160mm;
      min-height: 247mm;
      margin: 0 auto;
    }}
    .binding {{
      position: fixed;
      left: -10mm;
      top: 0;
      bottom: 0;
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
    .copy-mark {{
      position: absolute;
      left: 0;
      top: -18mm;
      font-size: 14pt;
      letter-spacing: .55em;
    }}
    .file-box {{
      position: absolute;
      right: 0;
      top: -18mm;
      font-size: 10pt;
      line-height: 1.3;
      min-width: 54mm;
    }}
    .title {{
      text-align: center;
      font-size: {title_font_size:.1f}pt;
      line-height: 1.8;
      letter-spacing: .02em;
      margin: 0 0 20mm;
      white-space: nowrap;
    }}
    .consultation-page .title {{ margin-bottom: 15mm; }}
    .issuer-contact {{
      margin: -15mm 0 5mm;
      font-size: 10pt;
      line-height: 1.35;
      text-align: left;
    }}
    .doc-type {{
      display: inline-block;
      margin-left: 12mm;
      letter-spacing: .35em;
    }}
    .meeting-title {{ margin-left: 9mm; letter-spacing: .15em; }}
    .handler {{
      position: absolute;
      right: 0;
      top: 16mm;
      width: 62mm;
      font-size: 12pt;
      line-height: 1.25;
      text-align: left;
    }}
    .recipient-line {{
      margin-top: 2mm;
      margin-bottom: 3mm;
      font-size: 16pt;
      line-height: 1.75;
    }}
    .meta {{ margin: 0 0 7mm; }}
    .meta-row,
    .meeting-small-row {{
      display: flex;
      align-items: baseline;
      min-height: 5.2mm;
      font-size: 12pt;
      line-height: 1.25;
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
      font-size: 16pt;
      line-height: 1.75;
    }}
    .large-label {{ white-space: nowrap; }}
    .large-value {{ min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }}
    .subject-section {{
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      column-gap: .45em;
      margin: 5mm 0;
      font-size: 16pt;
      line-height: 1.75;
      break-inside: avoid;
    }}
    .subject-label {{ white-space: nowrap; }}
    .subject-body {{ min-width: 0; white-space: pre-wrap; overflow-wrap: anywhere; }}
    .consultation-recipient {{
      margin: 3mm 0 3mm;
      font-size: 16pt;
      line-height: 1.75;
    }}
    .consultation-meta {{ margin-bottom: 2mm; }}
    .consultation-content {{
      margin-top: 0;
      font-size: 16pt;
      line-height: 1.75;
    }}
    .consultation-content .subject-section,
    .consultation-content .doc-section {{
      margin: 0 0 3mm;
    }}
    .consultation-content .subject-body,
    .consultation-content .doc-section-body {{
      line-height: 1.75;
    }}
    .consultation-content .doc-section-body {{
      margin-top: 0;
      padding-left: 0;
    }}
    .consultation-closing {{
      margin-top: 4mm;
      font-size: 16pt;
      line-height: 1.75;
    }}
    .consultation-final-recipient {{
      margin-top: 2mm;
      font-size: 16pt;
      line-height: 1.75;
    }}
    .consultation-date {{
      margin-top: 1mm;
      font-size: 14pt;
      line-height: 1.6;
    }}
    .doc-section {{ margin: 5mm 0; break-inside: auto; }}
    .doc-section-label {{
      font-size: 16pt;
      line-height: 1.75;
      break-after: avoid;
    }}
    .doc-section-body {{
      margin-top: 1mm;
      padding-left: 8mm;
      font-size: 16pt;
      line-height: 1.65;
    }}
    .decree-meta {{
      margin: 0 0 10mm;
      font-size: 12pt;
      line-height: 1.65;
    }}
    .decree-body {{
      margin: 8mm 0 0;
      font-size: 16pt;
      line-height: 1.75;
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
      word-break: normal;
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
    .meeting-note-label {{ margin-top: 5mm; font-size: 16pt; }}
    .agenda-body,
    .meeting-note-body {{
      margin-top: 1mm;
      padding-left: 8mm;
      font-size: 16pt;
      line-height: 1.75;
    }}
    .document-closing {{ break-inside: avoid; }}
    .copies {{ margin-top: 4mm; font-size: 12pt; line-height: 1.25; }}
    .signature {{
      display: inline-block;
      width: auto;
      max-width: 100%;
      margin-top: 10mm;
      break-inside: avoid;
      color: #003aa7;
      font-family: "OfficialKai","OfficialLishu","OfficialSerifTC","LiSu","STLiti",serif;
      font-size: 26pt;
      letter-spacing: .03em;
      white-space: nowrap;
    }}
    .consultation-page .signature {{ margin-top: 6mm; }}
    .meeting-seal {{
      display: block;
      width: 100%;
      margin: 9mm auto 0;
      break-inside: avoid;
      color: #003aa7;
      font-family: "OfficialLishu","OfficialKai","OfficialSerifTC","LiSu","STLiti",serif;
      font-size: 22pt;
      line-height: 1.2;
      letter-spacing: .03em;
      text-align: center;
      white-space: nowrap;
    }}
    .signature-title {{
      display: inline-block;
      margin-right: 5mm;
      font-family: "OfficialKai","標楷體","DFKai-SB",serif;
      font-size: 22pt;
      vertical-align: middle;
    }}
    .signature-name {{
      display: inline-block;
      font-family: "OfficialXingshu","OfficialLishu","OfficialKai","OfficialSerifTC","LiSu","STLiti",serif;
      font-size: 40pt;
      letter-spacing: .01em;
      vertical-align: middle;
      white-space: nowrap;
    }}
    .signature-acting {{
      display: block;
      font-size: 24pt;
      line-height: 1.6;
      white-space: nowrap;
    }}
    .signature-placeholder {{ color: #777; font-size: 12pt; }}
    .petition-appendix {{
      break-before: page;
      page-break-before: always;
      box-sizing: border-box;
      margin: 0;
      padding: 10mm 0 0;
      color: #161616;
      font-family: "OfficialKai","OfficialSerifTC","PMingLiU",serif;
    }}
    .petition-appendix-header {{ text-align: center; white-space: nowrap; }}
    .petition-appendix-header p {{ margin: 0 0 3mm; font-size: 12pt; letter-spacing: .35em; }}
    .petition-appendix-header h2 {{ margin: 0; font-family: "OfficialTitle","OfficialKai",serif; font-size: 28pt; font-weight: 400; letter-spacing: .2em; }}
    .petition-appendix-rule {{ width: 100%; height: 1px; margin: 8mm auto 10mm; background: #1d3557; }}
    .petition-appendix-meta {{ width: 100%; margin: 0; border-collapse: collapse; table-layout: fixed; }}
    .petition-appendix-meta th,
    .petition-appendix-meta td {{ min-height: 12mm; border: 1px solid #1d3557; padding: 2mm 3mm; font-size: 13pt; line-height: 1.5; vertical-align: middle; overflow-wrap: anywhere; }}
    .petition-appendix-meta th {{ width: 24mm; background: #eef3f8; text-align: center; white-space: nowrap; }}
    .petition-original {{ margin-top: 11mm; }}
    .petition-original h3 {{ margin: 0; padding-bottom: 3mm; border-bottom: 1px solid #1d3557; font-size: 16pt; font-weight: 400; letter-spacing: .12em; }}
    .petition-original > div {{ min-height: 105mm; padding: 6mm 3mm; font-size: 15pt; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }}
    .petition-appendix footer {{ margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #888; color: #555; font-size: 10.5pt; line-height: 1.55; }}
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">列印 / 另存 PDF</button></div>
  <div class="binding"><span>裝</span><span>訂</span><span>線</span></div>
  <main class="page{page_class}">
    <div class="copy-mark">{copy_mark}</div>
    <div class="file-box">檔　　號：{file_number}<br>保存年限：{retention_period}</div>
    <header class="title">{document_title}</header>
    {f'<aside class="handler">{handler_block}</aside>' if handler_block and not is_notice and not is_consultation else ""}
    {f'<div class="issuer-contact">{issuer_contact}</div>' if issuer_contact else ""}
    <section class="body">{body_html}</section>
  </main>
  {petition_appendix}
</body>
</html>"""
