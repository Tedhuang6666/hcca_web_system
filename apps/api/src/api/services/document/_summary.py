"""公文列表摘要僅摘錄原文，不將文件標題冒充主旨或摘要。"""

import re
from html import unescape

from api.models.document import Document


def document_content_summary(document: Document) -> str | None:
    """保留人工摘要；缺漏時從令文的第一個內容段落摘錄。"""
    headings = {
        re.sub(r"\s+", "", value)
        for value in (document.title, document.issuer_full_name or "")
        if value
    }

    def is_heading(text: str) -> bool:
        compact = re.sub(r"\s+", "", text)
        return compact in headings or bool(re.fullmatch(r"(?:國立)?新竹高級中學.*主席令", compact))

    summary = (document.summary or "").strip()
    if summary and not is_heading(summary):
        return summary
    if document.category != "decree":
        return None
    for body in (document.doc_description, document.content, document.action_required):
        if not body:
            continue
        text = re.sub(r"<(?:br\s*/?|/p|/div)>", "\n", body, flags=re.IGNORECASE)
        text = unescape(re.sub(r"<[^>]+>", "", text))
        for line in text.splitlines():
            line = re.sub(r"^\s*(?:#{1,6}\s*|>\s*)", "", line).strip(" *`_\t\r")
            if not line or is_heading(line):
                continue
            if re.match(
                r"^(?:中華民國\s*\d|\d{2,4}[年./-]|發文日期|發文字號|速別|密等|主席[：\s])", line
            ):
                continue
            if len(line) < 8:
                continue
            return line[:197] + "…" if len(line) > 200 else line
    return None
