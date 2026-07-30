"""狹窄且可稽核的自動恢復動作。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from api.core.config import settings
from api.core.recovery import clear_app_cache
from api.core.security import redis_client

RecoveryAction = Literal[
    "clear_cache",
    "restart",
    "reload_caddy",
    "maintenance_mode",
    "retry_task",
]

_ALLOWED_TARGETS: dict[str, frozenset[str]] = {
    "clear_cache": frozenset({"app"}),
    "restart": frozenset(
        {"api", "web", "celery-worker", "celery-worker-email", "celery-worker-util", "caddy"}
    ),
    "reload_caddy": frozenset({"caddy"}),
    "maintenance_mode": frozenset({"global"}),
    "retry_task": frozenset({"default", "email", "meal", "documents", "backup"}),
}
_TASK_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")


@dataclass(frozen=True)
class RecoveryResult:
    action: str
    target: str
    success: bool
    detail: str


def _validate_target(action: RecoveryAction, target: str) -> None:
    if target not in _ALLOWED_TARGETS[action]:
        raise ValueError(f"不允許的恢復目標：{action}/{target}")


async def _restart_allowed(target: str) -> bool:
    key = f"recovery:restart:{target}"
    current = await redis_client.get(key)
    return int(current or 0) < settings.RECOVERY_MAX_RESTARTS_PER_HOUR


async def _record_restart(target: str) -> None:
    key = f"recovery:restart:{target}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 3600)


async def _call_recovery_agent(
    *,
    action: RecoveryAction,
    target: str,
    task_id: str | None = None,
) -> RecoveryResult:
    if not settings.RECOVERY_AGENT_URL or not settings.RECOVERY_AGENT_TOKEN:
        return RecoveryResult(action, target, False, "未設定 Recovery Agent")

    payload: dict[str, Any] = {"action": action, "target": target}
    if task_id is not None:
        if not _TASK_ID_RE.fullmatch(task_id):
            return RecoveryResult(action, target, False, "task_id 格式不合法")
        payload["task_id"] = task_id

    try:
        async with httpx.AsyncClient(timeout=settings.HEALTHCHECK_TIMEOUT_SECONDS) as client:
            response = await client.post(
                settings.RECOVERY_AGENT_URL.rstrip("/") + "/v1/recover",
                json=payload,
                headers={"Authorization": f"Bearer {settings.RECOVERY_AGENT_TOKEN}"},
            )
            response.raise_for_status()
    except (httpx.HTTPError, ValueError) as exc:
        return RecoveryResult(action, target, False, f"Recovery Agent 失敗：{type(exc).__name__}")
    return RecoveryResult(action, target, True, "Recovery Agent 已接受動作")


async def execute_recovery(
    *,
    action: RecoveryAction,
    target: str,
    task_id: str | None = None,
) -> RecoveryResult:
    """只執行固定白名單動作，不接受 shell command。"""
    _validate_target(action, target)

    if action == "clear_cache":
        result = await clear_app_cache()
        return RecoveryResult(action, target, bool(result.get("cleared")), str(result))

    if action == "restart":
        if not await _restart_allowed(target):
            return RecoveryResult(action, target, False, "已達每小時重啟上限")
        result = await _call_recovery_agent(action=action, target=target)
        if result.success:
            await _record_restart(target)
        return result

    return await _call_recovery_agent(action=action, target=target, task_id=task_id)


__all__ = ["RecoveryAction", "RecoveryResult", "execute_recovery"]
