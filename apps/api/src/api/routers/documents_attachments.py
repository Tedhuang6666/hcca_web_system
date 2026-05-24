"""公文附件端點 — 上傳/連結/重命名/下載/預覽/刪除。

從 [routers/documents.py](apps/api/src/api/routers/documents.py) 提取。共用
[documents_helpers.py](apps/api/src/api/routers/documents_helpers.py) 中的存取
守衛與取公文輔助；URL 前綴與主 router 一致 (`/documents`)，由
[api/__init__.py](apps/api/src/api/__init__.py) 同步掛載。
"""

from __future__ import annotations

import os
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.models.document import DocumentAttachment
from api.models.user import User
from api.routers.documents_helpers import (
    assert_access,
    assert_can_edit,
    get_doc_or_404,
)
from api.schemas.document import AttachmentLinkCreate, AttachmentOut
from api.services import document as doc_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/documents", tags=["公文系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


class AttachmentRenameRequest(BaseModel):
    filename: str


@router.get(
    "/{doc_id}/attachments",
    response_model=list[AttachmentOut],
    summary="列出附件",
)
async def list_attachments(
    doc_id: str, session: DbDep, current_user: OptionalUser
) -> list[DocumentAttachment]:
    doc = await get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc_svc.can_anonymous_access_document(doc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    else:
        await assert_access(session, doc, current_user)
    storage = get_storage()
    for att in doc.attachments:
        if att.storage_key:
            att.__dict__["url"] = await storage.get_url(att.storage_key)
        else:
            att.__dict__["url"] = ""
    return doc.attachments


@router.post(
    "/{doc_id}/attachments",
    response_model=AttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳附件（支援 PDF / JPG / ZIP，最大 20MB）",
    responses={
        201: {"description": "上傳成功"},
        403: {"description": "無查看權限"},
        422: {"description": "檔案類型或大小不符規定"},
    },
)
async def upload_attachment(
    doc_id: str,
    session: DbDep,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="附件檔案（PDF / 圖片 / Office 文件 / ZIP）"),
) -> DocumentAttachment:
    doc = await get_doc_or_404(doc_id, session)
    await assert_access(session, doc, current_user)
    await assert_can_edit(session, doc, current_user)

    storage = get_storage()
    try:
        stored = await storage.save(file, prefix=str(doc.id))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e

    attachment = DocumentAttachment(
        document_id=doc.id,
        filename=stored.filename,
        storage_key=stored.storage_key,
        content_type=stored.content_type,
        file_size=stored.file_size,
        uploaded_by=current_user.id,
    )
    session.add(attachment)
    await session.flush()
    attachment.__dict__["url"] = stored.url
    return attachment


@router.post(
    "/{doc_id}/attachments/link",
    response_model=AttachmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增外部連結附件",
)
async def add_link_attachment(
    doc_id: str,
    body: AttachmentLinkCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> DocumentAttachment:
    doc = await get_doc_or_404(doc_id, session)
    await assert_access(session, doc, current_user)
    await assert_can_edit(session, doc, current_user)
    display = (
        body.display_text.strip() if body.display_text and body.display_text.strip() else body.url
    )
    attachment = DocumentAttachment(
        document_id=doc.id,
        filename=display,
        link_url=str(body.url),
        uploaded_by=current_user.id,
    )
    session.add(attachment)
    await session.flush()
    attachment.__dict__["url"] = ""
    return attachment


@router.delete(
    "/{doc_id}/attachments/{att_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除附件（上傳者或管理員）",
    responses={
        204: {"description": "刪除成功"},
        403: {"description": "非上傳者"},
        404: {"description": "附件不存在"},
    },
)
async def delete_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    doc = await get_doc_or_404(doc_id, session)
    await assert_access(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if att.uploaded_by != current_user.id and doc.created_by != current_user.id:
        await assert_can_edit(session, doc, current_user)

    storage = get_storage()
    await storage.delete(att.storage_key)
    await session.delete(att)


@router.patch(
    "/{doc_id}/attachments/{att_id}",
    response_model=AttachmentOut,
    summary="重新命名附件",
)
async def rename_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    payload: AttachmentRenameRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> DocumentAttachment:
    doc = await get_doc_or_404(doc_id, session)
    await assert_access(session, doc, current_user)
    await assert_can_edit(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    new_name = payload.filename.strip()
    if not new_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="附件名稱不可為空"
        )
    att.display_name = new_name
    await session.flush()
    storage = get_storage()
    att.__dict__["url"] = await storage.get_url(att.storage_key) if att.storage_key else ""
    return att


@router.get(
    "/{doc_id}/attachments/{att_id}/download",
    summary="下載附件（公開公文可匿名下載）",
)
async def download_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: OptionalUser,
) -> FileResponse:
    doc = await get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc_svc.can_anonymous_access_document(doc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    else:
        await assert_access(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if not att.storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="此附件為外部連結，無法直接下載"
        )

    file_path = os.path.join("uploads", att.storage_key)
    filename = att.display_name or att.filename
    encoded_filename = quote(filename.encode("utf-8"))
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=att.content_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


@router.get(
    "/{doc_id}/attachments/{att_id}/preview",
    summary="預覽附件（inline；避免瀏覽器自動下載）",
)
async def preview_attachment(
    doc_id: str,
    att_id: uuid.UUID,
    session: DbDep,
    current_user: OptionalUser,
) -> FileResponse:
    doc = await get_doc_or_404(doc_id, session)
    if current_user is None:
        if not doc_svc.can_anonymous_access_document(doc):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文")
    else:
        await assert_access(session, doc, current_user)
    result = await session.execute(
        select(DocumentAttachment).where(
            DocumentAttachment.id == att_id,
            DocumentAttachment.document_id == doc.id,
        )
    )
    att = result.scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此附件")
    if not att.storage_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="此附件為外部連結，無法直接預覽"
        )

    file_path = os.path.join("uploads", att.storage_key)
    filename = att.display_name or att.filename
    encoded_filename = quote(filename.encode("utf-8"))
    return FileResponse(
        path=file_path,
        media_type=att.content_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"},
    )
