"""個資處理 router — /admin/privacy

提供：
  - POST /admin/privacy/users/{user_id}/export    生成該使用者資料 ZIP
  - GET  /admin/privacy/exports                   列出已生成 ZIP
  - GET  /admin/privacy/exports/{filename}        下載 ZIP
  - POST /admin/privacy/users/{user_id}/anonymize 假名化（高危：二次確認）

所有寫操作均寫 audit_log。匯出 ZIP 包含當事人的：基本資料、通知、稽核紀錄、
公文、陳情、訂單、問卷回應等（依模型實際存在動態收集）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import audit as audit_svc
from api.services import privacy as svc

router = APIRouter(prefix="/admin/privacy", tags=["管理員 / 個資處理"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
PrivacyUser = Annotated[User, Depends(require_permission(PermissionCode.SYSTEM_PRIVACY))]


class ExportOut(BaseModel):
    user_id: uuid.UUID
    file_path: str
    size_bytes: int
    file_count: int
    generated_at: str


class ExportFileOut(BaseModel):
    filename: str
    size_bytes: int
    modified_at: str


class AnonymizeBody(BaseModel):
    # 二次確認；前端要求使用者打字「假名化」才送出
    confirm_token: str = Field(..., min_length=1, max_length=64)


class AnonymizeOut(BaseModel):
    user_id: uuid.UUID
    fields_updated: list[str]
    anonymized_at: str


@router.post("/users/{user_id}/export", response_model=ExportOut, summary="匯出當事人所有資料 ZIP")
async def export_user(user_id: uuid.UUID, db: DbDep, requester: PrivacyUser) -> ExportOut:
    try:
        result = await svc.export_user_data(db, user_id=user_id, requested_by_email=requester.email)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user_id),
        action="privacy.export",
        actor_id=str(requester.id),
        actor_email=requester.email,
        meta={
            "file_path": result.file_path,
            "size_bytes": result.size_bytes,
            "file_count": result.file_count,
        },
        summary=f"個資匯出 user={user_id}（{result.size_bytes} bytes）",
    )
    return ExportOut(
        user_id=result.user_id,
        file_path=result.file_path,
        size_bytes=result.size_bytes,
        file_count=result.file_count,
        generated_at=result.generated_at.isoformat(),
    )


@router.get("/exports", response_model=list[ExportFileOut], summary="列出已生成的匯出 ZIP")
async def list_exports(_u: PrivacyUser) -> list[ExportFileOut]:
    return [ExportFileOut(**f) for f in svc.list_exports()]


@router.get("/exports/download", summary="下載匯出 ZIP", response_class=StreamingResponse)
async def download_export(
    db: DbDep,
    requester: PrivacyUser,
    filename: str = Query(..., min_length=1),
) -> StreamingResponse:
    try:
        data = svc.read_export_bytes(filename)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="找不到匯出檔") from exc

    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=filename,
        action="privacy.export_download",
        actor_id=str(requester.id),
        actor_email=requester.email,
        meta={"filename": filename, "size_bytes": len(data)},
        summary=f"下載個資匯出檔：{filename}",
    )

    def _iter():
        yield data

    return StreamingResponse(
        _iter(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/users/{user_id}/anonymize", response_model=AnonymizeOut, summary="假名化（高危）")
async def anonymize_user(
    user_id: uuid.UUID, body: AnonymizeBody, db: DbDep, requester: PrivacyUser
) -> AnonymizeOut:
    # 二次確認：前端 UI 要求使用者打字「假名化」
    if body.confirm_token != "假名化":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="confirm_token 必須為「假名化」字串",
        )
    try:
        result = await svc.anonymize_user(db, user_id=user_id, requested_by_email=requester.email)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await audit_svc.record(
        db,
        entity_type="user",
        entity_id=str(user_id),
        action="privacy.anonymize",
        actor_id=str(requester.id),
        actor_email=requester.email,
        meta={"fields_updated": result.fields_updated},
        summary=f"假名化 user={user_id}（{len(result.fields_updated)} 欄）",
    )
    return AnonymizeOut(
        user_id=result.user_id,
        fields_updated=result.fields_updated,
        anonymized_at=result.anonymized_at.isoformat(),
    )
