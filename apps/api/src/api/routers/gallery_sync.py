"""網站管理員的活動照片來源與同步要求。"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.permissions import require_any
from api.models.user import User
from api.schemas.gallery_sync import GalleryDriveConfig, GalleryDriveStatusOut
from api.services import gallery_sync as sync
from api.services.audit import record
from api.services.gallery_drive import gallery_drive_ready

router = APIRouter(prefix="/admin/gallery-drive", tags=["活動照片來源"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
Manager = Annotated[User, Depends(require_any("site:manage", "admin:all"))]


@router.get("", response_model=GalleryDriveStatusOut)
async def get_status(session: DbDep, user: Manager) -> GalleryDriveStatusOut:
    return sync.status_out(await sync.get_source(session))


@router.put("", response_model=GalleryDriveStatusOut)
async def configure(
    body: GalleryDriveConfig, session: DbDep, user: Manager
) -> GalleryDriveStatusOut:
    try:
        source = await sync.configure(session, body, user.id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    await record(
        session,
        entity_type="gallery_drive_sync",
        entity_id=str(source.id),
        action="gallery_drive.configure",
        actor_id=str(user.id),
        summary="設定活動照片 Drive 來源",
        meta={"source_count": len(body.sources), "photographer_count": len(body.photographers)},
    )
    return sync.status_out(source)


@router.post("/run", response_model=GalleryDriveStatusOut, status_code=202)
async def request_sync(session: DbDep, user: Manager) -> GalleryDriveStatusOut:
    if not gallery_drive_ready():
        raise HTTPException(409, "尚未設定 Google Drive 唯讀授權")
    source = await sync.get_source(session, lock=True)
    if source is None or not source.config.get("sources"):
        raise HTTPException(409, "請先儲存活動照片來源")
    source.created_by = user.id
    source.manifest = {**source.manifest, "_cursor": {}}
    source.requested_at = datetime.now(UTC)
    await session.flush()
    await record(
        session,
        entity_type="gallery_drive_sync",
        entity_id=str(source.id),
        action="gallery_drive.request",
        actor_id=str(user.id),
        summary="要求同步活動照片",
    )
    return sync.status_out(source)
