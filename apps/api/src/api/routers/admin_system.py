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
from datetime import datetime
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
from api.core.query_audit import get_slow_queries
from api.core.security import revoke_user
from api.core.ws_manager import manager as ws_manager
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services import audit as audit_svc
from api.services import defense as defense_svc
from api.services.discord_bot import emit_security_alert

router = APIRouter(prefix="/admin/system", tags=["管理員 / 系統"])
public_router = APIRouter(prefix="/system", tags=["系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


async def require_superuser(user: User = Depends(get_current_active_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要超級管理員權限",
        )
    return user


AdminUser = Annotated[User, Depends(require_superuser)]


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


@public_router.get("/maintenance", response_model=MaintenanceView, summary="公開維護狀態")
async def public_maintenance_status() -> MaintenanceView:
    state = await get_maintenance_state()
    return MaintenanceView(**state)


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


DefenseRuleTypeLiteral = Literal[
    "ip_block",
    "cidr_block",
    "ip_allow",
    "rate_limit_override",
    "endpoint_lockdown",
    "bot_challenge_placeholder",
]


class DefenseRuleCreate(BaseModel):
    rule_type: DefenseRuleTypeLiteral
    target: str = Field(..., min_length=1, max_length=255)
    reason: str = Field("", max_length=1000)
    config: dict = Field(default_factory=dict)
    expires_at: datetime | None = None


class DefenseRuleUpdate(BaseModel):
    rule_type: DefenseRuleTypeLiteral | None = None
    target: str | None = Field(None, min_length=1, max_length=255)
    is_active: bool | None = None
    reason: str | None = Field(None, max_length=1000)
    config: dict | None = None
    expires_at: datetime | None = None


class DefenseRuleOut(BaseModel):
    id: str
    rule_type: str
    target: str
    is_active: bool
    reason: str
    config: dict
    expires_at: float | None
    created_by: str | None
    updated_by: str | None
    created_at: str
    updated_at: str


class RateLimitOverride(BaseModel):
    path_prefix: str = Field(..., min_length=1, max_length=200)
    requests: int = Field(..., ge=1, le=100_000)
    window_seconds: int = Field(..., ge=1, le=86_400)


class RateLimitConfigBody(BaseModel):
    enabled: bool = True
    global_requests: int = Field(..., ge=1, le=100_000)
    global_window_seconds: int = Field(..., ge=1, le=86_400)
    overrides: list[RateLimitOverride] = Field(default_factory=list)


class DefenseSummary(BaseModel):
    active_rule_count: int
    total_rule_count: int
    active_by_type: dict[str, int]
    active_rules: list[DefenseRuleOut]
    rate_limit: dict
    recent_status_counts: dict[str, int]


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
async def update_maintenance(
    body: MaintenanceBody, session: DbDep, _admin: AdminUser
) -> MaintenanceView:
    state = await set_maintenance_mode(enabled=body.enabled, message=body.message, until=body.until)
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="maintenance",
        action="set_maintenance",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta=state,
        summary="更新維護模式",
    )
    await emit_security_alert(
        session,
        title="系統維護模式已更新",
        body=f"enabled={state.get('enabled')} actor={_admin.email}",
    )
    return MaintenanceView(**state)


# ── Feature Flags ────────────────────────────────────────────────────────────


@router.get("/feature-flags", response_model=list[FeatureFlagItem])
async def list_flags(_admin: AdminUser) -> list[FeatureFlagItem]:
    items = await list_feature_flags()
    return [FeatureFlagItem(**i) for i in items]


@router.patch("/feature-flags/{key:path}", response_model=FeatureFlagItem)
async def update_flag(
    key: str, body: SetFlagBody, session: DbDep, _admin: AdminUser
) -> FeatureFlagItem:
    from api.core.maintenance import FEATURE_FLAGS_DEFAULT

    if key not in FEATURE_FLAGS_DEFAULT:
        raise HTTPException(status_code=404, detail="未知的 feature flag")
    await set_feature_flag(key, enabled=body.enabled)
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=key,
        action="set_feature_flag",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"key": key, "enabled": body.enabled},
        summary=f"更新功能開關 {key}",
    )
    return FeatureFlagItem(key=key, description=FEATURE_FLAGS_DEFAULT[key], enabled=body.enabled)


# ── Load Shed Mode ───────────────────────────────────────────────────────────


@router.put("/load-shed", response_model=dict)
async def update_load_shed_mode(body: LoadShedBody, session: DbDep, _admin: AdminUser) -> dict:
    mode = await set_load_shed_force_mode(body.mode)
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="load_shed",
        action="set_load_shed",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"mode": mode},
        summary=f"更新 Load Shed 模式：{mode}",
    )
    await emit_security_alert(
        session,
        title="Load Shed 模式已更新",
        body=f"mode={mode} actor={_admin.email}",
    )
    return {"mode": mode}


# ── Defense Rules / Rate Limit ──────────────────────────────────────────────


@router.get("/defense/summary", response_model=DefenseSummary)
async def defense_summary(session: DbDep, _admin: AdminUser) -> DefenseSummary:
    data = await defense_svc.summary(session)
    return DefenseSummary(
        **{
            **data,
            "active_rules": [DefenseRuleOut(**item) for item in data["active_rules"]],
        }
    )


@router.get("/defense/rules", response_model=list[DefenseRuleOut])
async def list_defense_rules(
    session: DbDep,
    _admin: AdminUser,
    active_only: bool = False,
    limit: int = 100,
    offset: int = 0,
) -> list[DefenseRuleOut]:
    rows = await defense_svc.list_rules(
        session, active_only=active_only, limit=min(max(limit, 1), 200), offset=max(offset, 0)
    )
    return [DefenseRuleOut(**defense_svc.rule_to_dict(row)) for row in rows]


@router.post("/defense/rules", response_model=DefenseRuleOut, status_code=status.HTTP_201_CREATED)
async def create_defense_rule(
    body: DefenseRuleCreate, session: DbDep, _admin: AdminUser
) -> DefenseRuleOut:
    rule = await defense_svc.create_rule(
        session,
        actor=_admin,
        rule_type=body.rule_type,
        target=body.target,
        reason=body.reason,
        config=body.config,
        expires_at=body.expires_at,
    )
    await emit_security_alert(
        session,
        title="新增防禦規則",
        body=f"{body.rule_type} {body.target}\nactor={_admin.email}\nreason={body.reason}",
    )
    return DefenseRuleOut(**defense_svc.rule_to_dict(rule))


@router.patch("/defense/rules/{rule_id}", response_model=DefenseRuleOut)
async def update_defense_rule(
    rule_id: uuid.UUID, body: DefenseRuleUpdate, session: DbDep, _admin: AdminUser
) -> DefenseRuleOut:
    updates = body.model_dump(exclude_unset=True)
    rule = await defense_svc.update_rule(session, actor=_admin, rule_id=rule_id, updates=updates)
    await emit_security_alert(
        session,
        title="更新防禦規則",
        body=f"rule={rule_id}\nactor={_admin.email}",
    )
    return DefenseRuleOut(**defense_svc.rule_to_dict(rule))


@router.delete("/defense/rules/{rule_id}", response_model=DefenseRuleOut)
async def deactivate_defense_rule(
    rule_id: uuid.UUID, session: DbDep, _admin: AdminUser
) -> DefenseRuleOut:
    rule = await defense_svc.deactivate_rule(session, actor=_admin, rule_id=rule_id)
    await emit_security_alert(
        session,
        title="停用防禦規則",
        body=f"rule={rule_id}\nactor={_admin.email}",
    )
    return DefenseRuleOut(**defense_svc.rule_to_dict(rule))


@router.get("/rate-limit", response_model=dict)
async def get_rate_limit(_admin: AdminUser) -> dict:
    from api.core.defense import get_rate_limit_config

    return await get_rate_limit_config()


@router.put("/rate-limit", response_model=dict)
async def update_rate_limit(body: RateLimitConfigBody, session: DbDep, _admin: AdminUser) -> dict:
    config = body.model_dump()
    return await defense_svc.set_rate_limit_config(session, actor=_admin, config=config)


# ── IP 黑名單 ────────────────────────────────────────────────────────────────


@router.get("/ip-blocklist", response_model=list[IpBlockedItem])
async def get_ip_blocklist(_admin: AdminUser) -> list[IpBlockedItem]:
    return [IpBlockedItem(**i) for i in await ip_list_blocked()]


@router.post("/ip-blocklist", response_model=IpBlockedItem, status_code=status.HTTP_201_CREATED)
async def add_ip_block(body: IpBlockBody, session: DbDep, _admin: AdminUser) -> IpBlockedItem:
    await ip_block(body.ip, reason=body.reason, ttl_seconds=body.ttl_seconds)
    expires_at = (time.time() + body.ttl_seconds) if body.ttl_seconds else None
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=body.ip,
        action="block_ip",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"ip": body.ip, "reason": body.reason, "ttl_seconds": body.ttl_seconds},
        summary=f"緊急封鎖 IP {body.ip}",
    )
    await emit_security_alert(
        session,
        title="緊急封鎖 IP",
        body=f"ip={body.ip}\nactor={_admin.email}\nreason={body.reason}",
    )
    return IpBlockedItem(ip=body.ip, reason=body.reason, expires_at=expires_at)


@router.delete("/ip-blocklist/{ip}", response_model=dict)
async def remove_ip_block(ip: str, session: DbDep, _admin: AdminUser) -> dict:
    ok = await ip_unblock(ip)
    if not ok:
        raise HTTPException(status_code=404, detail="此 IP 不在黑名單中")
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=ip,
        action="unblock_ip",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"ip": ip},
        summary=f"解除緊急 IP 封鎖 {ip}",
    )
    await emit_security_alert(
        session,
        title="解除 IP 封鎖",
        body=f"ip={ip}\nactor={_admin.email}",
    )
    return {"ip": ip, "removed": True}


# ── 強制登出 ────────────────────────────────────────────────────────────────


@router.post("/revoke-user-tokens", response_model=dict)
async def force_logout_user(body: RevokeUserBody, session: DbDep, _admin: AdminUser) -> dict:
    count = await revoke_user(str(body.user_id))
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=str(body.user_id),
        action="revoke_user_tokens",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"user_id": str(body.user_id), "revoked_count": count},
        summary=f"強制登出使用者 {body.user_id}",
    )
    await emit_security_alert(
        session,
        title="強制登出使用者",
        body=f"user_id={body.user_id}\nrevoked_count={count}\nactor={_admin.email}",
    )
    return {"user_id": str(body.user_id), "revoked_count": count}


# ── WebSocket 統計（admin 視角） ─────────────────────────────────────────────


@router.get("/ws/rooms", response_model=dict)
async def ws_rooms_overview(_admin: AdminUser) -> dict:
    return {
        "stats": ws_manager.stats(),
        "rooms": ws_manager.list_rooms(),
        "ips": ws_manager.list_ip_counts(),
    }


# ── 慢查詢監控（query_audit ring buffer） ───────────────────────────────────


@router.get("/metrics/slow-queries", response_model=dict, summary="近期慢查詢樣本")
async def metrics_slow_queries(
    _admin: AdminUser,
    top: int = 10,
) -> dict:
    """
    回傳記憶體 ring buffer 中聚合過的慢查詢樣本（>50ms）。
    template 已去除字面值，只看 SQL 結構；不會洩漏實際資料內容。
    """
    return {"top": top, "items": get_slow_queries(top=top)}
