"""產生包含陳情案件附件的列印 PDF。"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from io import BytesIO
from pathlib import Path

from pypdf.errors import PdfReadError

from api.models.petition import PetitionAttachmentVisibility, PetitionCase
from api.services.official_print import (
    render_petition_attachment_cover_html,
    render_petition_print_html,
    render_print_pdf,
)
from api.services.petition_preview import (
    OFFICE_EXTENSIONS,
    PetitionPreviewError,
    convert_office_attachment_to_pdf,
)
from api.services.storage import get_storage

_IMAGE_EXTENSIONS = frozenset({".gif", ".jpg", ".jpeg", ".png", ".webp"})


def _render_petition_case_pdf(
    case_obj: PetitionCase,
    attachment_names: Sequence[tuple[int, str, str]],
    image_attachments: Sequence[tuple[int, str, bytes]],
    document_attachments: Sequence[tuple[int, str, bytes]],
) -> bytes:
    from pypdf import PdfWriter

    html_content = render_petition_print_html(
        case_obj,
        attachment_names=attachment_names,
        image_attachments=image_attachments,
    )
    main_pdf = render_print_pdf(html_content)
    if not document_attachments:
        return main_pdf

    writer = PdfWriter()
    writer.append(BytesIO(main_pdf))
    for number, filename, document_pdf in document_attachments:
        cover_html = render_petition_attachment_cover_html(
            case_obj.case_number,
            number,
            filename,
        )
        writer.append(BytesIO(render_print_pdf(cover_html)))
        writer.append(BytesIO(document_pdf))

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


async def render_petition_case_pdf(
    case_obj: PetitionCase,
    *,
    include_internal: bool,
) -> bytes:
    """讀取可見附件，將圖片嵌入詳情，並接續列印 PDF／Office 文件。"""
    storage = get_storage()
    attachment_names: list[tuple[int, str, str]] = []
    image_attachments: list[tuple[int, str, bytes]] = []
    document_attachments: list[tuple[int, str, bytes]] = []

    number = 0
    for attachment in case_obj.attachments:
        if attachment.visibility == PetitionAttachmentVisibility.INTERNAL and not include_internal:
            continue

        number += 1
        filename = attachment.display_name or attachment.filename
        extension = Path(attachment.storage_key).suffix.lower()
        content_type = (attachment.content_type or "").lower()
        content = await storage.read_bytes(attachment.storage_key)

        if content_type.startswith("image/") or extension in _IMAGE_EXTENSIONS:
            attachment_names.append((number, filename, "圖片已列入文件頁面"))
            image_attachments.append((number, filename, content))
        elif content_type == "application/pdf" or extension == ".pdf":
            attachment_names.append((number, filename, "文件接續列印"))
            document_attachments.append((number, filename, content))
        elif extension in OFFICE_EXTENSIONS:
            attachment_names.append((number, filename, "文件接續列印"))
            document_pdf = await convert_office_attachment_to_pdf(content, attachment.storage_key)
            document_attachments.append((number, filename, document_pdf))
        else:
            raise PetitionPreviewError("不支援此附件格式的列印")

    try:
        return await asyncio.to_thread(
            _render_petition_case_pdf,
            case_obj,
            attachment_names,
            image_attachments,
            document_attachments,
        )
    except PdfReadError as exc:
        raise PetitionPreviewError("PDF 附件無法列印") from exc
