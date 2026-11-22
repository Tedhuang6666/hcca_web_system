"""Resolve the Google Drive PDF associated with a synchronized regulation."""

from __future__ import annotations

import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.regulation import Regulation
from api.models.regulation_sync import RegulationSyncSource

_DRIVE_FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,200}$")


def normalized_title(title: str) -> str:
    return re.sub(r"[\s\u3000]+", "", title)


async def get_regulation_pdf_file_id(session: AsyncSession, regulation: Regulation) -> str | None:
    """取得同步來源 manifest 中法規對應的 Drive PDF；舊 manifest 僅在唯一候選時回退。"""
    source = (
        await session.execute(
            select(RegulationSyncSource).where(RegulationSyncSource.org_id == regulation.org_id)
        )
    ).scalar_one_or_none()
    if source is None:
        return None

    regulation_id = str(regulation.id)
    linked_ids: set[str] = set()
    mapped_pdfs: list[tuple[datetime, str]] = []
    for file_id, entry in source.manifest.items():
        if not isinstance(entry, dict) or entry.get("regulation_id") != regulation_id:
            continue
        linked_ids.add(file_id)
        pdf_file_id = entry.get("pdf_file_id")
        if isinstance(pdf_file_id, str) and _DRIVE_FILE_ID_RE.fullmatch(pdf_file_id):
            raw_modified_time = entry.get("pdf_modified_time")
            try:
                modified_time = (
                    datetime.fromisoformat(raw_modified_time.replace("Z", "+00:00"))
                    if isinstance(raw_modified_time, str)
                    else datetime.min.replace(tzinfo=UTC)
                )
            except ValueError:
                modified_time = datetime.min.replace(tzinfo=UTC)
            if modified_time.tzinfo is None:
                modified_time = modified_time.replace(tzinfo=UTC)
            else:
                modified_time = modified_time.astimezone(UTC)
            mapped_pdfs.append((modified_time, pdf_file_id))
    if mapped_pdfs:
        return max(mapped_pdfs, key=lambda item: item[0])[1]

    if not isinstance(source.last_report, dict):
        return None
    report_items = source.last_report.get("items", [])
    if not isinstance(report_items, list):
        return None
    linked_items = [
        item
        for item in report_items
        if isinstance(item, dict) and item.get("file_id") in linked_ids
    ]
    title = next(
        (item.get("title") for item in linked_items if isinstance(item.get("title"), str)),
        regulation.title,
    )
    target_title = normalized_title(title)
    pdf_candidates = []
    for item in report_items:
        if not isinstance(item, dict):
            continue
        filename = item.get("filename")
        file_id = item.get("file_id")
        if not isinstance(filename, str) or not filename.casefold().endswith(".pdf"):
            continue
        item_title = item.get("title")
        if not isinstance(item_title, str):
            item_title = re.sub(r"\.pdf$", "", filename, flags=re.I)
        if normalized_title(item_title) == target_title and isinstance(file_id, str):
            pdf_candidates.append(file_id)
    if len(pdf_candidates) == 1 and _DRIVE_FILE_ID_RE.fullmatch(pdf_candidates[0]):
        return pdf_candidates[0]
    return None
