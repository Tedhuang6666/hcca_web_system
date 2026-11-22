"""陳情送件期間的附件儲存與清理。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Sequence

from fastapi import UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.petition import PetitionAttachmentVisibility, PetitionCase
from api.services import petition as petition_svc
from api.services.storage import get_storage

logger = logging.getLogger(__name__)
MAX_PETITION_SUBMISSION_ATTACHMENTS = 10


async def save_petition_submission_attachments(
    session: AsyncSession,
    case_obj: PetitionCase,
    attachments: Sequence[UploadFile],
    *,
    uploaded_by: uuid.UUID,
) -> None:
    if len(attachments) > MAX_PETITION_SUBMISSION_ATTACHMENTS:
        raise ValueError(f"陳情附件最多 {MAX_PETITION_SUBMISSION_ATTACHMENTS} 個")

    storage = get_storage()
    stored_keys: list[str] = []
    completed = False
    try:
        for file in attachments:
            stored = await storage.save(file, prefix=f"petitions/{case_obj.case_number}")
            stored_keys.append(stored.storage_key)
            await petition_svc.add_attachment(
                session,
                case_obj,
                filename=stored.filename,
                storage_key=stored.storage_key,
                content_type=stored.content_type,
                file_size=stored.file_size,
                visibility=PetitionAttachmentVisibility.PUBLIC,
                uploaded_by=uploaded_by,
            )
        completed = True
    finally:
        if not completed and stored_keys:
            cleanup_results = await asyncio.gather(
                *(storage.delete(storage_key) for storage_key in stored_keys),
                return_exceptions=True,
            )
            for storage_key, result in zip(stored_keys, cleanup_results, strict=True):
                if isinstance(result, BaseException):
                    logger.warning(
                        "陳情附件清理失敗 storage_key=%s",
                        storage_key,
                        exc_info=(type(result), result, result.__traceback__),
                    )
