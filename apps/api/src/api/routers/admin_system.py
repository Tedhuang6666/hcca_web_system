"""管理員系統狀態與緊急工具 — /admin/system

提供：
  - 即時指標（DB pool / Redis / WS / Celery / load signals）
  - Maintenance mode 切換
  - Feature flag 即時開關
  - Load shed mode 強制覆蓋
  - IP 黑名單 CRUD
  - 強制登出特定使用者（revoke 所有 jti）
"""

from __future__ import annotations

import time
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import engine, get_db
from api.core.ip_blocklist import block as ip_block
from api.core.ip_blocklist import list_blocked as ip_list_blocked
from api.core.ip_blocklist import unblock as ip_unblock
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import (
    get_load_shed_force_mode,
    get_maintenance_state,
    list_feature_flags,
    set_feature_flag,
    set_load_shed_force_mode,
    set_maintenance_mode,
)
from api.core.metrics import (
    DbPoolSnapshot,
    get_celery_stats,
    get_db_pool_stats,
    get_redis_stats,
)
from api.core.permission_codes import PermissionCode
from api.core.security import revoke_user
from api.core.ws_manager import manager as ws_manager
from api.dependencies.permissions import require_permission
from api.models.user import User

router = APIRouter(prefix="/admin/system", tags=["管理員 / 系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_permission(PermissionCode.ADMIN_ALL))]


# ── Schemas ──────────────────────────────────────────────────────────────────


class DbPoolView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    size: int
    checked_in: int
    checked_out: int
    overflow: int
    utilization: float


class WsRoomCount(BaseModel):
    room: str
    connections: int


class WsView(BaseModel):
    total: int
    rooms: int
    unique_ips: int
    per_room: list[WsRoomCount]
    limits: dict


class CeleryQueueView(BaseModel):
    name: str
    active: int = 0
    reserved: int = 0


class CeleryView(BaseModel):
    queues: list[CeleryQueueView]
    error: str | None = None


class RedisView(BaseModel):
    connected_clients: int
    blocked_clients: int
    error: str | None = None


class LoadSignalsView(BaseModel):
    active_requests: int
    recent_5xx_ratio: float
    recent_5xx_count: int
    window_seconds: int


class MaintenanceView(BaseModel):
    enabled: bool
    message: str = ""
    until: float | None = None


class SystemMetricsSnapshot(BaseModel):
    timestamp: float
    db_pool: DbPoolView
    redis: RedisView
    ws: WsView
    celery: CeleryView
    load_signals: LoadSignalsView
    maintenance: MaintenanceView
    load_shed_mode: str


class FeatureFlagItem(BaseModel):
    key: str
    description: str
    enabled: bool


class SetFlagBody(BaseModel):
    enabled: bool


class MaintenanceBody(BaseModel):
    enabled: bool
    message: str = Field("", max_length=500)
    until: float | None = Field(None, description="Unix timestamp，到期自動解除")


class LoadShedBody(BaseModel):
    mode: Literal["off", "auto", "on", "bypass"]


class IpBlockBody(BaseModel):
    ip: str = Field(..., min_length=1, max_length=64)
    reason: str = Field("", max_length=500)
    ttl_seconds: int | None = Field(3600, ge=60, le=30 * 86400)


class IpBlockedItem(BaseModel):
    ip: str
    reason: str = ""
    expires_at: float | None = None


class RevokeUserBody(BaseModel):
    user_id: uuid.UUID


# ── 即時指標總集 ─────────────────────────────────────────────────────────────


def _to_db_view(s: DbPoolSnapshot) -> DbPoolView:
    return DbPoolView(
        size=s.size,
        checked_in=s.checked_in,
        checked_out=s.checked_out,
        overflow=s.overflow,
        utilization=round(s.utilization, 4),
    )


@router.get("/status", response_model=SystemMetricsSnapshot, summary="即時系統指標")
async def system_status(_admin: AdminUser) -> SystemMetricsSnapshot:
    db = get_db_pool_stats(engine)
    redis = await get_redis_stats()
    celery = await get_celery_stats()
    ws_stats = ws_manager.stats()
    maintenance = await get_maintenance_state()
    return SystemMetricsSnapshot(
        timestamp=time.time(),
        db_pool=_to_db_view(db),
        redis=RedisView(**redis),
        ws=WsView(
            total=int(ws_stats["total"]),
            rooms=int(ws_stats["rooms"]),
            unique_ips=int(ws_stats["unique_ips"]),
            per_room=[WsRoomCount(**r) for r in ws_manager.list_rooms()],
            limits=ws_stats["limits"],
        ),
        celery=CeleryView(
            queues=[CeleryQueueView(**q) for q in celery.get("queues", [])],
            error=celery.get("error"),
        ),
        load_signals=LoadSignalsView(**load_snapshot()),
        maintenance=MaintenanceView(**maintenance),
        load_shed_mode=await get_load_shed_force_mode(),
    )


# ── Maintenance ──────────────────────────────────────────────────────────────


@router.get("/maintenance", response_model=MaintenanceView)
async def get_maintenance(_admin: AdminUser) -> MaintenanceView:
    state = await get_maintenance_state()
    return MaintenanceView(**state)


@router.put("/maintenance", response_model=MaintenanceView)
async def update_maintenance(body: MaintenanceBody, _admin: AdminUser) -> MaintenanceView:
    state = await set_maintenance_mode(enabled=body.enabled, message=body.message, until=body.until)
    return MaintenanceView(**state)


# ── Feature Flags ────────────────────────────────────────────────────────────


@router.get("/feature-flags", response_model=list[FeatureFlagItem])
async def list_flags(_admin: AdminUser) -> list[FeatureFlagItem]:
    items = await list_feature_flags()
    return [FeatureFlagItem(**i) for i in items]


@router.patch("/feature-flags/{key:path}", response_model=FeatureFlagItem)
async def update_flag(key: str, body: SetFlagBody, _admin: AdminUser) -> FeatureFlagItem:
    from api.core.maintenance import FEATURE_FLAGS_DEFAULT

    if key not in FEATURE_FLAGS_DEFAULT:
        raise HTTPException(status_code=404, detail="未知的 feature flag")
    await set_feature_flag(key, enabled=body.enabled)
    return FeatureFlagItem(key=key, description=FEATURE_FLAGS_DEFAULT[key], enabled=body.enabled)


# ── Load Shed Mode ───────────────────────────────────────────────────────────


@router.put("/load-shed", response_model=dict)
async def update_load_shed_mode(body: LoadShedBody, _admin: AdminUser) -> dict:
    mode = await set_load_shed_force_mode(body.mode)
    return {"mode": mode}


# ── IP 黑名單 ────────────────────────────────────────────────────────────────


@router.get("/ip-blocklist", response_model=list[IpBlockedItem])
async def get_ip_blocklist(_admin: AdminUser) -> list[IpBlockedItem]:
    return [IpBlockedItem(**i) for i in await ip_list_blocked()]


@router.post("/ip-blocklist", response_model=IpBlockedItem, status_code=status.HTTP_201_CREATED)
async def add_ip_block(body: IpBlockBody, _admin: AdminUser) -> IpBlockedItem:
    await ip_block(body.ip, reason=body.reason, ttl_seconds=body.ttl_seconds)
    expires_at = (time.time() + body.ttl_seconds) if body.ttl_seconds else None
    return IpBlockedItem(ip=body.ip, reason=body.reason, expires_at=expires_at)


@router.delete("/ip-blocklist/{ip}", response_model=dict)
async def remove_ip_block(ip: str, _admin: AdminUser) -> dict:
    ok = await ip_unblock(ip)
    if not ok:
        raise HTTPException(status_code=404, detail="此 IP 不在黑名單中")
    return {"ip": ip, "removed": True}


# ── 強制登出 ────────────────────────────────────────────────────────────────


@router.post("/revoke-user-tokens", response_model=dict)
async def force_logout_user(body: RevokeUserBody, _admin: AdminUser) -> dict:
    count = await revoke_user(str(body.user_id))
    return {"user_id": str(body.user_id), "revoked_count": count}


# ── WebSocket 統計（admin 視角） ─────────────────────────────────────────────


@router.get("/ws/rooms", response_model=dict)
async def ws_rooms_overview(_admin: AdminUser) -> dict:
    return {
        "stats": ws_manager.stats(),
        "rooms": ws_manager.list_rooms(),
        "ips": ws_manager.list_ip_counts(),
    }
