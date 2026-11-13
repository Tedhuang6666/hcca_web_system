"""法規管理員設定來源及要求同步；權限固定在組織範圍。"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import get_db
from api.dependencies.permissions import require_permission
from api.models.org import Org
from api.models.regulation_sync import RegulationSyncSource
from api.models.user import User
from api.schemas.regulation_sync import RegulationSyncSourceUpdate, RegulationSyncStatusOut
from api.services.audit import record
from api.services.permission import get_user_permission_codes_for_org
from api.services.regulation_sync import next_sync

router = APIRouter(prefix="/sync", tags=["法規來源同步"])
DbDep = Annotated[AsyncSession, Depends(get_db)]
Manager = Annotated[User, Depends(require_permission("regulation:admin"))]


async def _assert_org(session: AsyncSession, user: User, org_id: uuid.UUID) -> None:
    if not user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, user.id, org_id)
        if "regulation:admin" not in codes:
            raise HTTPException(403, "需要此組織的 regulation:admin 權限")
    org = await session.get(Org, org_id)
    if org is None or not org.is_active:
        raise HTTPException(404, "找不到此組織")


async def _source(session: AsyncSession, org_id: uuid.UUID) -> RegulationSyncSource | None:
    return (
        await session.execute(
            select(RegulationSyncSource).where(RegulationSyncSource.org_id == org_id)
        )
    ).scalar_one_or_none()


@router.get("/{org_id}", response_model=RegulationSyncStatusOut)
async def get_sync_status(org_id: uuid.UUID, session: DbDep, user: Manager) -> dict:
    await _assert_org(session, user, org_id)
    source = await _source(session, org_id)
    return {
        "configured": source is not None,
        "source": source,
        "drive_ready": bool(settings.GOOGLE_DRIVE_API_KEY),
    }


@router.put("/{org_id}", response_model=RegulationSyncStatusOut)
async def configure_sync(
    org_id: uuid.UUID, body: RegulationSyncSourceUpdate, session: DbDep, user: Manager
) -> dict:
    await _assert_org(session, user, org_id)
    # 與同步任務共用列鎖，不讓舊執行結果覆蓋新來源設定。
    source = (
        await session.execute(
            select(RegulationSyncSource)
            .where(RegulationSyncSource.org_id == org_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if source is None:
        source = RegulationSyncSource(org_id=org_id, manifest={}, last_report={})
        session.add(source)
    if source.folder_id and source.folder_id != body.folder_id:
        source.manifest, source.last_report = {}, {}
        source.last_synced_at = None
    source.folder_id, source.frequency = body.folder_id, body.frequency
    source.created_by = user.id
    source.next_sync_at = next_sync(body.frequency, datetime.now(UTC))
    await session.flush()
    await record(
        session,
        entity_type="regulation_sync",
        entity_id=str(source.id),
        action="regulation_sync.configure",
        actor_id=str(user.id),
        summary="設定法規同步來源與頻率",
        meta=body.model_dump(),
    )
    return {
        "configured": True,
        "source": source,
        "drive_ready": bool(settings.GOOGLE_DRIVE_API_KEY),
    }


@router.post("/{org_id}/run", response_model=RegulationSyncStatusOut, status_code=202)
async def request_sync(org_id: uuid.UUID, session: DbDep, user: Manager) -> dict:
    await _assert_org(session, user, org_id)
    if not settings.GOOGLE_DRIVE_API_KEY:
        raise HTTPException(409, "尚未設定 Drive API 金鑰，請由系統管理員完成設定")
    source = (
        await session.execute(
            select(RegulationSyncSource)
            .where(RegulationSyncSource.org_id == org_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if source is None:
        raise HTTPException(409, "請先儲存法規來源")
    source.requested_at = datetime.now(UTC)
    source.created_by = user.id
    await session.flush()
    await record(
        session,
        entity_type="regulation_sync",
        entity_id=str(source.id),
        action="regulation_sync.request",
        actor_id=str(user.id),
        summary="要求同步法規來源",
    )
    # 要求與稽核在同一交易持久化；Beat 每分鐘掃描，Broker 暫斷不會遺失要求。
    return {"configured": True, "source": source, "drive_ready": True}
