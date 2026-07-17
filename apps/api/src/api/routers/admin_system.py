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

import hashlib
import hmac
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from redis.exceptions import RedisError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core import app_settings as app_settings_svc
from api.core import recovery
from api.core.anomaly_detection import get_login_ips
from api.core.config import settings
from api.core.database import engine, get_db
from api.core.defense import find_identity_block
from api.core.error_audit import clear_errors, find_error_by_id, get_recent_errors
from api.core.ip_blocklist import block as ip_block
from api.core.ip_blocklist import get_block as get_ip_block
from api.core.ip_blocklist import list_blocked as ip_list_blocked
from api.core.ip_blocklist import unblock as ip_unblock
from api.core.load_signals import snapshot as load_snapshot
from api.core.maintenance import (
    clear_module_maintenance,
    get_load_shed_force_mode,
    get_maintenance_state,
    list_feature_flags,
    list_module_maintenance,
    set_feature_flag,
    set_load_shed_force_mode,
    set_maintenance_mode,
    set_module_maintenance,
    set_module_reset,
)
from api.core.metrics import (
    DbPoolSnapshot,
    get_celery_stats,
    get_db_pool_stats,
    get_redis_stats,
)
from api.core.module_health import (
    get_trip_meta,
    module_5xx_count,
    module_severity_breakdown,
    recent_trip_events,
)
from api.core.module_recovery import attempt_recovery, probe_module
from api.core.modules import MODULES
from api.core.query_audit import get_slow_queries
from api.core.security import redis_client, revoke_user
from api.core.ws_manager import manager as ws_manager
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_admin_mfa
from api.models.email_message import EmailMessage
from api.models.user import User
from api.models.user_identity import UserIdentity
from api.services import audit as audit_svc
from api.services import defense as defense_svc
from api.services import mfa as mfa_svc
from api.services import version as version_svc
from api.services.discord_bot import emit_security_alert

router = APIRouter(prefix="/admin/system", tags=["管理員 / 系統"])
public_router = APIRouter(prefix="/system", tags=["系統"])
logger = logging.getLogger(__name__)

DbDep = Annotated[AsyncSession, Depends(get_db)]

# 進程啟動時間（用於 diagnostics uptime；模組載入 ≈ app 啟動）
_PROCESS_START_MONO = time.monotonic()

# diagnostics 觀測的 Celery queue（與 docker-compose worker --queues 對齊）
_DIAGNOSTIC_QUEUES = ["default", "email", "meal", "documents", "backup", "recovery", "celery"]


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


class ModuleStatusOut(BaseModel):
    id: str
    label: str
    on: bool
    mode: Literal["maintenance", "closed"] = "maintenance"
    source: str | None = None
    reason: str = ""
    since: float | None = None
    until: float | None = None
    recent_5xx_count: int = 0
    severity_breakdown: dict[str, int] = Field(default_factory=dict)
    trip_count: int = 0
    max_severity: str = "NORMAL"


class ModuleRecoverResult(BaseModel):
    module_id: str
    recovered: bool
    probe_ok: bool
    probe_reason: str = ""


class ModuleTripHistoryItem(BaseModel):
    timestamp: float
    severity: str
    trip_count: int
    cooldown_s: int
    escalated: bool


class ModuleTripHistory(BaseModel):
    module_id: str
    trip_count: int
    max_severity: str
    recent_5xx_count: int
    severity_breakdown: dict[str, int]
    recent_events: list[ModuleTripHistoryItem]


class ModuleStatusPublic(BaseModel):
    id: str
    label: str
    on: bool
    mode: Literal["maintenance", "closed"] = "maintenance"
    reason: str = ""
    until: float | None = None


class ModuleMaintenanceBody(BaseModel):
    on: bool
    mode: Literal["maintenance", "closed"] = "maintenance"
    reason: str = Field("", max_length=500)


class AccessBlockStatus(BaseModel):
    blocked: bool
    reason: str = ""
    expires_at: float | None = None


@public_router.get(
    "/module-status", response_model=list[ModuleStatusPublic], summary="公開模組維護狀態"
)
async def public_module_status() -> list[ModuleStatusPublic]:
    states = await list_module_maintenance()
    out: list[ModuleStatusPublic] = []
    for mid, spec in MODULES.items():
        st = states.get(mid)
        out.append(
            ModuleStatusPublic(
                id=mid,
                label=spec.label,
                on=bool(st and st.get("on")),
                mode=(st or {}).get("mode", "maintenance"),
                reason=(st or {}).get("reason", "") if st else "",
                until=(st or {}).get("until") if st else None,
            )
        )
    return out


@public_router.get(
    "/access-status",
    response_model=AccessBlockStatus,
    summary="檢查目前訪客是否遭封鎖",
)
async def public_access_status(
    request: Request,
    session: DbDep,
    user: User | None = Depends(get_optional_user),
) -> AccessBlockStatus:
    ip = request.client.host if request.client else "unknown"
    ip_block = await get_ip_block(ip)
    if ip_block:
        return AccessBlockStatus(
            blocked=True,
            reason=str(ip_block.get("reason") or "未提供原因"),
            expires_at=ip_block.get("expires_at"),
        )
    if user is None:
        return AccessBlockStatus(blocked=False)

    identity_emails = await session.scalars(
        select(UserIdentity.email).where(
            UserIdentity.user_id == user.id,
            UserIdentity.email.is_not(None),
        )
    )
    identity_block = await find_identity_block(
        user_id=str(user.id),
        emails={user.email, *(email for email in identity_emails.all() if email)},
    )
    if not identity_block:
        return AccessBlockStatus(blocked=False)
    return AccessBlockStatus(
        blocked=True,
        reason=str(identity_block.get("reason") or "未提供原因"),
        expires_at=identity_block.get("expires_at"),
    )


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
    "user_block",
    "email_block",
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


class UserBlockPreview(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    emails: list[str]
    ips: list[str]


class UserBlockBody(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=255)
    reason: str = Field(..., min_length=1, max_length=1000)
    expires_at: datetime | None = None
    include_emails: bool = True
    include_ips: bool = False


class UserBlockResult(UserBlockPreview):
    rules: list[DefenseRuleOut]
    revoked_count: int


class DeadLetterItem(BaseModel):
    timestamp: str | None = None
    status: str | None = None
    task: str | None = None
    task_id: str | None = None
    queue: str | None = None
    retries: int | None = None
    exception_type: str | None = None
    exception: str | None = None
    args: list[str] = Field(default_factory=list)
    kwargs: dict[str, str] = Field(default_factory=dict)
    replay_args: list[Any] | None = None
    replay_kwargs: dict[str, Any] | None = None
    replay_sig: str | None = None


class DeadLetterResponse(BaseModel):
    key: str
    items: list[DeadLetterItem]


class DeadLetterReplayBody(BaseModel):
    expected_task: str = Field(..., min_length=1, max_length=200)


# ── 即時指標總集 ─────────────────────────────────────────────────────────────


def _to_db_view(s: DbPoolSnapshot) -> DbPoolView:
    return DbPoolView(
        size=s.size,
        checked_in=s.checked_in,
        checked_out=s.checked_out,
        overflow=s.overflow,
        utilization=round(s.utilization, 4),
    )


def _ws_view() -> WsView:
    ws_stats = ws_manager.stats()
    return WsView(
        total=int(ws_stats["total"]),
        rooms=int(ws_stats["rooms"]),
        unique_ips=int(ws_stats["unique_ips"]),
        per_room=[WsRoomCount(**r) for r in ws_manager.list_rooms()],
        limits=ws_stats["limits"],
    )


@router.get("/status", response_model=SystemMetricsSnapshot, summary="即時系統指標")
async def system_status(_admin: AdminUser) -> SystemMetricsSnapshot:
    db = get_db_pool_stats(engine)
    redis = await get_redis_stats()
    celery = await get_celery_stats()
    maintenance = await get_maintenance_state()
    return SystemMetricsSnapshot(
        timestamp=time.time(),
        db_pool=_to_db_view(db),
        redis=RedisView(**redis),
        ws=_ws_view(),
        celery=CeleryView(
            queues=[CeleryQueueView(**q) for q in celery.get("queues", [])],
            error=celery.get("error"),
        ),
        load_signals=LoadSignalsView(**load_snapshot()),
        maintenance=MaintenanceView(**maintenance),
        load_shed_mode=await get_load_shed_force_mode(),
    )


class DiagnosticsCheck(BaseModel):
    ok: bool
    detail: str | None = None


class QueueDepth(BaseModel):
    name: str
    pending: int  # broker backlog（-1 代表查詢失敗）


class DiagnosticsView(BaseModel):
    timestamp: float
    version: str
    uptime_seconds: float
    db: DiagnosticsCheck
    redis: DiagnosticsCheck
    celery: DiagnosticsCheck
    workers: list[CeleryQueueView]
    queue_depths: list[QueueDepth]
    email_queue_pending: int
    email_outbox: dict[str, int]  # status -> 件數（含 retrying / dead）
    ws: WsView


class RuntimeVersionView(BaseModel):
    app_version: str
    commit: str | None
    ref: str | None
    built_at: str | None
    environment: str


class GitHubVersionView(BaseModel):
    repository: str
    branch: str
    sha: str | None
    short_sha: str | None
    message: str | None
    pushed_at: str | None
    url: str | None


class VersionStatusView(BaseModel):
    runtime: RuntimeVersionView
    github: GitHubVersionView | None
    sync_status: Literal["current", "outdated", "unknown"]
    github_error: str | None = None


@router.get("/version", response_model=VersionStatusView, summary="運行與 GitHub 版本")
async def system_version(_admin: AdminUser) -> VersionStatusView:
    runtime = RuntimeVersionView(**version_svc.runtime_version())
    github_data, github_error = await version_svc.github_version()
    github = GitHubVersionView(**github_data) if github_data else None
    sync_status: Literal["current", "outdated", "unknown"] = "unknown"
    if runtime.commit and github and github.sha:
        sync_status = "current" if github.sha.startswith(runtime.commit) else "outdated"
    return VersionStatusView(
        runtime=runtime,
        github=github,
        sync_status=sync_status,
        github_error=github_error,
    )


@router.get("/diagnostics", response_model=DiagnosticsView, summary="一鍵健康診斷（管理員）")
async def system_diagnostics(_admin: AdminUser, db: DbDep) -> DiagnosticsView:
    """彙整 DB / Redis / Celery / queue 積壓 / email outbox / WebSocket / uptime / 版本，
    供管理員一眼判斷系統健康與寄信積壓。每項皆容錯，不因單一子系統故障而整體 500。"""
    # DB
    try:
        await db.execute(text("SELECT 1"))
        db_check = DiagnosticsCheck(ok=True)
    except Exception as exc:  # noqa: BLE001
        db_check = DiagnosticsCheck(ok=False, detail=exc.__class__.__name__)

    # Redis
    redis = await get_redis_stats()
    redis_check = DiagnosticsCheck(ok=redis.get("error") is None, detail=redis.get("error"))

    # Celery workers
    celery = await get_celery_stats()
    workers = [CeleryQueueView(**q) for q in celery.get("queues", [])]
    celery_err = celery.get("error") or (None if workers else "no_workers")
    celery_check = DiagnosticsCheck(ok=celery_err is None, detail=celery_err)

    # Queue 積壓（Celery on Redis：每個 queue 是一條 Redis list）
    depths: list[QueueDepth] = []
    email_pending = 0
    for q in _DIAGNOSTIC_QUEUES:
        try:
            n = int(await redis_client.llen(q))
        except RedisError:
            n = -1
        depths.append(QueueDepth(name=q, pending=n))
        if q == "email":
            email_pending = max(n, 0)

    # Email outbox 狀態彙總
    try:
        rows = (
            await db.execute(
                select(EmailMessage.status, func.count()).group_by(EmailMessage.status)
            )
        ).all()
        outbox = {str(row[0]): int(row[1]) for row in rows}
    except Exception:  # noqa: BLE001
        outbox = {}

    return DiagnosticsView(
        timestamp=time.time(),
        version=settings.APP_VERSION,
        uptime_seconds=round(time.monotonic() - _PROCESS_START_MONO, 1),
        db=db_check,
        redis=redis_check,
        celery=celery_check,
        workers=workers,
        queue_depths=depths,
        email_queue_pending=email_pending,
        email_outbox=outbox,
        ws=_ws_view(),
    )


@router.get(
    "/dead-letters",
    response_model=DeadLetterResponse,
    summary="檢視 Celery Dead Letter Queue",
)
async def list_dead_letters(_admin: AdminUser, limit: int = 50) -> DeadLetterResponse:
    raw_items = await redis_client.lrange(settings.CELERY_DLQ_REDIS_KEY, 0, max(0, limit - 1))
    items: list[DeadLetterItem] = []
    for raw in raw_items:
        try:
            parsed = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(parsed, dict):
            items.append(DeadLetterItem(**parsed))
    return DeadLetterResponse(key=settings.CELERY_DLQ_REDIS_KEY, items=items)


@router.delete(
    "/dead-letters",
    response_model=dict,
    summary="清空 Celery Dead Letter Queue",
    dependencies=[Depends(require_admin_mfa)],
)
async def clear_dead_letters(session: DbDep, _admin: AdminUser) -> dict:
    removed = await redis_client.delete(settings.CELERY_DLQ_REDIS_KEY)
    await audit_svc.record(
        session,
        entity_type="celery_dead_letter",
        entity_id=settings.CELERY_DLQ_REDIS_KEY,
        action="clear",
        actor_id=str(_admin.id),
        meta={"removed": bool(removed)},
        summary="清空 Celery Dead Letter Queue",
    )
    await session.commit()
    return {"cleared": bool(removed), "key": settings.CELERY_DLQ_REDIS_KEY}


@router.post(
    "/dead-letters/{index}/replay",
    response_model=dict,
    summary="安全重放單筆 Celery Dead Letter",
    dependencies=[Depends(require_admin_mfa)],
)
async def replay_dead_letter(
    index: int,
    body: DeadLetterReplayBody,
    session: DbDep,
    _admin: AdminUser,
) -> dict:
    if index < 0:
        raise HTTPException(status_code=400, detail="index 不可小於 0")
    raw = await redis_client.lindex(settings.CELERY_DLQ_REDIS_KEY, index)
    if raw is None:
        raise HTTPException(status_code=404, detail="Dead letter 不存在")
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=409, detail="Dead letter 格式損壞") from exc

    task = payload.get("task") if isinstance(payload, dict) else None
    replay_args = payload.get("replay_args") if isinstance(payload, dict) else None
    replay_kwargs = payload.get("replay_kwargs") if isinstance(payload, dict) else None
    if task != body.expected_task:
        raise HTTPException(status_code=409, detail="expected_task 與 dead letter 不符")
    if not isinstance(task, str) or not task.startswith("api.services."):
        raise HTTPException(status_code=409, detail="只允許重放平台內部 task")
    if not isinstance(replay_args, list) or not isinstance(replay_kwargs, dict):
        raise HTTPException(status_code=409, detail="此舊項目未保存可安全重放的原始參數")

    # 驗證 HMAC 簽名，防止 Redis 內容遭篡改後注入惡意 args
    replay_sig = payload.get("replay_sig") if isinstance(payload, dict) else None
    if not replay_sig:
        raise HTTPException(status_code=409, detail="此項目缺少驗簽資料（舊格式），請清除後重試")
    expected_sig_body = json.dumps(
        {"task": task, "replay_args": replay_args, "replay_kwargs": replay_kwargs},
        sort_keys=True,
        ensure_ascii=False,
    ).encode()
    expected_sig = hmac.new(
        settings.SECRET_KEY.encode(),
        expected_sig_body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_sig, replay_sig):
        raise HTTPException(status_code=409, detail="Dead letter 驗簽失敗，可能遭篡改，拒絕執行")

    from api.core.celery_app import celery_app

    result = celery_app.send_task(task, args=replay_args, kwargs=replay_kwargs)
    await redis_client.lrem(settings.CELERY_DLQ_REDIS_KEY, 1, raw)
    await audit_svc.record(
        session,
        entity_type="celery_dead_letter",
        entity_id=str(payload.get("task_id") or index),
        action="replay",
        actor_id=str(_admin.id),
        meta={"task": task, "new_task_id": result.id},
        summary=f"重放 Celery task：{task}",
    )
    await session.commit()
    return {"replayed": True, "task": task, "task_id": result.id}


# ── Maintenance ──────────────────────────────────────────────────────────────


@router.get("/maintenance", response_model=MaintenanceView)
async def get_maintenance(_admin: AdminUser) -> MaintenanceView:
    state = await get_maintenance_state()
    return MaintenanceView(**state)


@router.put(
    "/maintenance", response_model=MaintenanceView, dependencies=[Depends(require_admin_mfa)]
)
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


@router.patch(
    "/feature-flags/{key:path}",
    response_model=FeatureFlagItem,
    dependencies=[Depends(require_admin_mfa)],
)
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


@router.put("/load-shed", response_model=dict, dependencies=[Depends(require_admin_mfa)])
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


# ── 模組維護（per-module maintenance） ───────────────────────────────────────


def _validate_module(module_id: str) -> None:
    if module_id not in MODULES:
        raise HTTPException(status_code=404, detail="未知的模組")


@router.get("/modules", response_model=list[ModuleStatusOut])
async def list_modules(_admin: AdminUser) -> list[ModuleStatusOut]:
    states = await list_module_maintenance()
    out: list[ModuleStatusOut] = []
    for mid, spec in MODULES.items():
        st = states.get(mid) or {}
        meta = await get_trip_meta(mid)
        out.append(
            ModuleStatusOut(
                id=mid,
                label=spec.label,
                on=bool(st.get("on")),
                mode=st.get("mode", "maintenance"),
                source=st.get("source"),
                reason=st.get("reason", ""),
                since=st.get("since"),
                until=st.get("until"),
                recent_5xx_count=module_5xx_count(mid),
                severity_breakdown=module_severity_breakdown(mid),
                trip_count=int(meta["trip_count"]),
                max_severity=str(meta["max_severity"]),
            )
        )
    return out


@router.put(
    "/modules/{module_id}/maintenance",
    response_model=ModuleStatusOut,
    dependencies=[Depends(require_admin_mfa)],
)
async def update_module_maintenance(
    module_id: str, body: ModuleMaintenanceBody, session: DbDep, _admin: AdminUser
) -> ModuleStatusOut:
    _validate_module(module_id)
    state = await set_module_maintenance(
        module_id,
        on=body.on,
        mode=body.mode,
        source="manual",
        reason=body.reason,
    )
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=f"module:{module_id}",
        action="set_module_maintenance",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"module": module_id, "on": body.on, "mode": body.mode, "reason": body.reason},
        summary=(
            f"關閉模組：{MODULES[module_id].label}"
            if body.on and body.mode == "closed"
            else f"{'開啟' if body.on else '關閉'}模組維護：{MODULES[module_id].label}"
        ),
    )
    await emit_security_alert(
        session,
        title="模組維護狀態已更新",
        body=f"module={module_id} on={body.on} mode={body.mode} actor={_admin.email}",
    )
    await ws_manager.broadcast_all(
        {
            "type": "module_maintenance",
            "module": module_id,
            "on": body.on,
            "mode": body.mode,
        }
    )
    return ModuleStatusOut(
        id=module_id,
        label=MODULES[module_id].label,
        on=bool(state.get("on")),
        mode=state.get("mode", "maintenance"),
        source=state.get("source"),
        reason=state.get("reason", ""),
        since=state.get("since"),
        until=state.get("until"),
        recent_5xx_count=module_5xx_count(module_id),
    )


@router.post("/modules/{module_id}/restart", response_model=dict)
async def restart_module(module_id: str, session: DbDep, _admin: AdminUser) -> dict:
    """重啟模組：清除維護旗標（手動 + 自動）並重置健康計數窗，立即恢復服務。"""
    _validate_module(module_id)
    await clear_module_maintenance(module_id)
    await set_module_reset(module_id, window_seconds=settings.MODULE_CIRCUIT_WINDOW_SECONDS)
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=f"module:{module_id}",
        action="restart_module",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"module": module_id},
        summary=f"重啟模組：{MODULES[module_id].label}",
    )
    await emit_security_alert(
        session,
        title="模組已重啟",
        body=f"module={module_id} actor={_admin.email}",
    )
    await ws_manager.broadcast_all({"type": "module_maintenance", "module": module_id, "on": False})
    return {"ok": True, "module": module_id}


@router.post(
    "/modules/{module_id}/recover",
    response_model=ModuleRecoverResult,
    summary="清除升級計數器並強制嘗試恢復",
)
async def recover_module(module_id: str, session: DbDep, _admin: AdminUser) -> ModuleRecoverResult:
    """admin 點「強制恢復」按鈕。

    流程：
      1. 清升級計數器（trip_count / max_severity）
      2. 打模組 /__module_health__ 探測一次
      3. 通過 → 解除維護 + 重置 5xx 計數窗
      4. 不通過 → 維持目前維護狀態（但計數器已歸零，下次跳閘從頭算）
    """
    _validate_module(module_id)
    from api.core.module_health import clear_trip_count

    await clear_trip_count(module_id)
    ok, reason = await probe_module(module_id)
    recovered = False
    if ok:
        recovered = await attempt_recovery(module_id, force=True)

    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id=f"module:{module_id}",
        action="recover_module",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"module": module_id, "probe_ok": ok, "recovered": recovered, "reason": reason},
        summary=f"嘗試恢復模組：{MODULES[module_id].label}（{'成功' if recovered else '失敗'}）",
    )
    await emit_security_alert(
        session,
        title="嘗試恢復模組",
        body=f"module={module_id} probe_ok={ok} recovered={recovered} actor={_admin.email}",
    )
    if recovered:
        await ws_manager.broadcast_all(
            {"type": "module_maintenance", "module": module_id, "on": False}
        )
    return ModuleRecoverResult(
        module_id=module_id, recovered=recovered, probe_ok=ok, probe_reason=reason
    )


@router.get(
    "/modules/{module_id}/trip-history",
    response_model=ModuleTripHistory,
    summary="模組跳閘歷史與當前計數",
)
async def module_trip_history(module_id: str, _admin: AdminUser) -> ModuleTripHistory:
    _validate_module(module_id)
    meta = await get_trip_meta(module_id)
    breakdown = module_severity_breakdown(module_id)
    return ModuleTripHistory(
        module_id=module_id,
        trip_count=int(meta["trip_count"]),
        max_severity=str(meta["max_severity"]),
        recent_5xx_count=module_5xx_count(module_id),
        severity_breakdown=breakdown,
        recent_events=[
            ModuleTripHistoryItem.model_validate(item) for item in recent_trip_events(module_id)
        ],
    )


# ── 系統設定 / .env 編輯（高危：flag-gated + MFA） ───────────────────────────


class AppSettingFieldOut(BaseModel):
    key: str
    category: str
    type: str
    is_secret: bool
    in_file: bool
    value: str
    description: str = ""


class AppSettingsListResponse(BaseModel):
    enabled: bool
    mfa_enabled: bool
    env_path: str
    fields: list[AppSettingFieldOut]


class RevealBody(BaseModel):
    mfa_code: str = Field(..., min_length=4, max_length=16)
    keys: list[str] = Field(default_factory=list)


class RevealResponse(BaseModel):
    values: dict[str, str]


class SaveSettingsBody(BaseModel):
    mfa_code: str = Field(..., min_length=4, max_length=16)
    changes: dict[str, str] = Field(default_factory=dict)


class SaveSettingsResponse(BaseModel):
    updated: list[str]
    restart_required: bool = True


def _require_env_editor_enabled() -> None:
    """flag 關閉時連 404，連端點存在都不透露。"""
    if not settings.ENABLE_ENV_EDITOR:
        raise HTTPException(status_code=404, detail="Not Found")


async def _require_mfa(db: AsyncSession, user: User, code: str) -> None:
    """強制 MFA 再驗證；未啟用 MFA 直接拒絕（避免 verify_mfa 的 pass-through）。"""
    if not user.mfa_enabled:
        raise HTTPException(status_code=403, detail="請先啟用 MFA 才能執行此操作")
    if not code or not await mfa_svc.verify_mfa(db, user, code):
        raise HTTPException(status_code=403, detail="MFA 驗證失敗")


@router.get("/settings", response_model=AppSettingsListResponse)
async def list_app_settings(_admin: AdminUser) -> AppSettingsListResponse:
    _require_env_editor_enabled()
    return AppSettingsListResponse(
        enabled=True,
        mfa_enabled=bool(_admin.mfa_enabled),
        env_path=str(app_settings_svc.resolve_env_path()),
        fields=[AppSettingFieldOut(**f) for f in app_settings_svc.list_fields()],
    )


@router.post("/settings/reveal", response_model=RevealResponse)
async def reveal_app_settings(
    body: RevealBody, session: DbDep, _admin: AdminUser
) -> RevealResponse:
    _require_env_editor_enabled()
    await _require_mfa(session, _admin, body.mfa_code)

    env = app_settings_svc.read_env_file()
    requested = [k for k in body.keys if k in app_settings_svc.editable_keys()]
    secret_only = [k for k in requested if app_settings_svc.is_secret_key(k)]
    # 只回密鑰真值（非密鑰不需要 reveal）
    values = {k: env.get(k, "") for k in secret_only}

    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="app_settings",
        action="reveal_secrets",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"keys": secret_only},  # 僅鍵名，永不記值
        summary=f"檢視 {len(secret_only)} 項密鑰",
    )
    await emit_security_alert(
        session,
        title="系統設定密鑰已被檢視",
        body=f"actor={_admin.email} keys={','.join(secret_only)}",
    )
    return RevealResponse(values=values)


@router.put("/settings", response_model=SaveSettingsResponse)
async def save_app_settings(
    body: SaveSettingsBody, session: DbDep, _admin: AdminUser
) -> SaveSettingsResponse:
    _require_env_editor_enabled()
    await _require_mfa(session, _admin, body.mfa_code)

    if not body.changes:
        return SaveSettingsResponse(updated=[], restart_required=False)

    try:
        app_settings_svc.validate_changes(body.changes)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"設定值無效：{exc.errors()}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        updated = app_settings_svc.write_env_changes(body.changes)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"寫入 .env 失敗：{exc}") from exc

    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="app_settings",
        action="save_settings",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"keys": updated},  # 僅鍵名，永不記值
        summary=f"更新 {len(updated)} 項系統設定（待重啟生效）",
    )
    await emit_security_alert(
        session,
        title="系統設定已更新（待重啟）",
        body=f"actor={_admin.email} keys={','.join(updated)}",
    )
    return SaveSettingsResponse(updated=updated, restart_required=True)


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


@router.post(
    "/defense/rules",
    response_model=DefenseRuleOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_mfa)],
)
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


@router.patch(
    "/defense/rules/{rule_id}",
    response_model=DefenseRuleOut,
    dependencies=[Depends(require_admin_mfa)],
)
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


@router.delete(
    "/defense/rules/{rule_id}",
    response_model=DefenseRuleOut,
    dependencies=[Depends(require_admin_mfa)],
)
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


@router.get("/defense/users/{identifier}", response_model=UserBlockPreview)
async def preview_user_block(
    identifier: str,
    session: DbDep,
    _admin: AdminUser,
) -> UserBlockPreview:
    user, emails = await defense_svc.get_user_block_targets(session, identifier)
    return UserBlockPreview(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        emails=emails,
        ips=await get_login_ips(str(user.id)),
    )


@router.post(
    "/defense/user-blocks",
    response_model=UserBlockResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_mfa)],
)
async def block_user(
    body: UserBlockBody,
    session: DbDep,
    _admin: AdminUser,
) -> UserBlockResult:
    user, emails = await defense_svc.get_user_block_targets(session, body.identifier)
    if user.id == _admin.id:
        raise HTTPException(status_code=409, detail="不可封鎖目前登入的管理員帳號")

    ips = await get_login_ips(str(user.id))
    targets = [("user_block", str(user.id))]
    if body.include_emails:
        targets.extend(("email_block", email) for email in emails)
    if body.include_ips:
        targets.extend(("ip_block", ip) for ip in ips)

    rules = [
        await defense_svc.create_rule(
            session,
            actor=_admin,
            rule_type=rule_type,
            target=target,
            reason=body.reason,
            expires_at=body.expires_at,
            config={"source": "user_block", "user_id": str(user.id)},
        )
        for rule_type, target in targets
    ]
    revoked_count = await revoke_user(str(user.id))
    await emit_security_alert(
        session,
        title="封鎖使用者",
        body=(
            f"user={user.id}\nemail={user.email}\nactor={_admin.email}\n"
            f"rules={len(rules)}\nreason={body.reason}"
        ),
    )
    return UserBlockResult(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        emails=emails,
        ips=ips,
        rules=[DefenseRuleOut(**defense_svc.rule_to_dict(rule)) for rule in rules],
        revoked_count=revoked_count,
    )


@router.get("/rate-limit", response_model=dict)
async def get_rate_limit(_admin: AdminUser) -> dict:
    from api.core.defense import get_rate_limit_config

    return await get_rate_limit_config()


@router.put("/rate-limit", response_model=dict, dependencies=[Depends(require_admin_mfa)])
async def update_rate_limit(body: RateLimitConfigBody, session: DbDep, _admin: AdminUser) -> dict:
    config = body.model_dump()
    return await defense_svc.set_rate_limit_config(session, actor=_admin, config=config)


# ── IP 黑名單 ────────────────────────────────────────────────────────────────


@router.get("/ip-blocklist", response_model=list[IpBlockedItem])
async def get_ip_blocklist(_admin: AdminUser) -> list[IpBlockedItem]:
    return [IpBlockedItem(**i) for i in await ip_list_blocked()]


@router.post(
    "/ip-blocklist",
    response_model=IpBlockedItem,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin_mfa)],
)
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


@router.delete("/ip-blocklist/{ip}", response_model=dict, dependencies=[Depends(require_admin_mfa)])
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


@router.post("/revoke-user-tokens", response_model=dict, dependencies=[Depends(require_admin_mfa)])
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


# ── 近期錯誤（error_audit ring buffer） ──────────────────────────────────────


class RecentErrorItem(BaseModel):
    error_id: str
    request_id: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    category: str
    exc_type: str
    message: str
    method: str
    path: str
    status_code: int
    traceback_head: str
    first_seen: float
    last_seen: float
    occurrences: int
    source: str = "memory"


class RecentErrorsResponse(BaseModel):
    count: int
    items: list[RecentErrorItem]


@router.get("/errors", response_model=RecentErrorsResponse, summary="近期伺服器錯誤")
async def recent_errors(_admin: AdminUser, top: int = 50) -> RecentErrorsResponse:
    """記憶體 ring buffer 中最近的 5xx／未處理例外，依 last_seen 由新到舊。重啟後清空。"""
    items = get_recent_errors(top=top)
    return RecentErrorsResponse(count=len(items), items=[RecentErrorItem(**i) for i in items])


@router.get("/errors/{error_id}", response_model=RecentErrorItem, summary="依錯誤代碼查詢錯誤報告")
async def error_by_id(error_id: str, _admin: AdminUser) -> RecentErrorItem:
    """依使用者回報的 error_id 查詢該次錯誤摘要；會查 memory ring buffer 與 Redis 報告事件。"""
    item = await find_error_by_id(error_id)
    if item is None:
        raise HTTPException(status_code=404, detail="找不到此錯誤代碼")
    return RecentErrorItem(**item)


@router.post("/errors/clear", response_model=dict, summary="清空錯誤緩衝")
async def clear_recent_errors(_admin: AdminUser) -> dict:
    return {"cleared": clear_errors()}


# ── 復原工具（清快取 / 升級資料庫 / 重啟） ──────────────────────────────────


@router.post(
    "/recovery/clear-cache",
    response_model=dict,
    summary="清除應用層快取",
    dependencies=[Depends(require_admin_mfa)],
)
async def recovery_clear_cache(session: DbDep, _admin: AdminUser) -> dict:
    result = await recovery.clear_app_cache()
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="cache",
        action="recovery_clear_cache",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta=result,
        summary="清除應用層快取",
    )
    await emit_security_alert(
        session,
        title="清除應用層快取",
        body=f"cleared={result['cleared']} actor={_admin.email}",
    )
    return {"ok": True, **result}


@router.post(
    "/recovery/db-upgrade",
    response_model=dict,
    summary="升級資料庫到最新版本",
    dependencies=[Depends(require_admin_mfa)],
)
async def recovery_db_upgrade(session: DbDep, _admin: AdminUser) -> dict:
    """執行 alembic upgrade head。"""
    try:
        result = await recovery.run_db_upgrade()
    except Exception:  # noqa: BLE001
        logger.exception("Database upgrade failed")
        await emit_security_alert(
            session,
            title="資料庫升級失敗",
            body=f"actor={_admin.email}",
        )
        return {
            "ok": False,
            "error": "資料庫升級失敗，詳細資訊已記錄於伺服器日誌",
        }
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="db",
        action="recovery_db_upgrade",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta=result,
        summary="升級資料庫到最新版本",
    )
    await emit_security_alert(
        session,
        title="資料庫升級完成",
        body=f"before={result['before_revision']} head={result['head_revision']} "
        f"changed={result['changed']} actor={_admin.email}",
    )
    return {"ok": True, **result}


@router.post(
    "/recovery/restart",
    response_model=dict,
    summary="重啟服務",
    dependencies=[Depends(require_admin_mfa)],
)
async def recovery_restart(background: BackgroundTasks, session: DbDep, _admin: AdminUser) -> dict:
    """依環境觸發重啟（dev 熱重載 / prod SIGHUP gunicorn master）。回應送出後才執行。"""
    await audit_svc.record(
        session,
        entity_type="defense_rule",
        entity_id="service",
        action="recovery_restart",
        actor_id=str(_admin.id),
        actor_email=_admin.email,
        meta={"environment": settings.ENVIRONMENT},
        summary="觸發服務重啟",
    )
    await emit_security_alert(
        session,
        title="服務重啟已觸發",
        body=f"environment={settings.ENVIRONMENT} actor={_admin.email}",
    )
    background.add_task(recovery.perform_restart)
    return {"scheduled": True, "environment": settings.ENVIRONMENT}
