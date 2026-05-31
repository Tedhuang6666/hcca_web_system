"""Admin Impersonation。Phase C3 / [docs/iso27001/E-access-control.md]。

行為：
- 管理員（持 admin:impersonate）可申請以另一 user 身分檢視
- 產生短效（預設 30 分鐘）impersonation token：JWT 內含 sub=target、imp=actor
- 前端帶此 token 呼叫 API，下游一律以 target 身分看資料
- read-only：任何 unsafe method 被擋（impersonation guard middleware）
- 完整 audit log：開始 / 寫操作嘗試 / 結束

模型上不存新表（純 JWT-based）；audit log 使用既有 AuditLog。
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from jwt import InvalidTokenError
from jwt import encode as jwt_encode
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.security import decode_token
from api.models.user import User
from api.services import audit_chain

logger = logging.getLogger(__name__)

IMPERSONATION_DEFAULT_MINUTES = 30
IMPERSONATION_MAX_MINUTES = 60


class ImpersonationError(RuntimeError):
    """impersonation 流程錯誤的統一例外。"""


def create_impersonation_token(
    *,
    actor: User,
    target: User,
    minutes: int = IMPERSONATION_DEFAULT_MINUTES,
) -> str:
    """產生 impersonation JWT。

    Claim:
        sub: target user id（下游 auth 拿到此 sub）
        type: "impersonation"
        imp: actor user id
        ttl: 限定
    """
    if not actor.is_superuser and actor.id == target.id:
        raise ImpersonationError("不能 impersonate 自己")
    if target.is_superuser and not actor.is_superuser:
        raise ImpersonationError("一般管理員不能 impersonate 最高權限者")

    minutes = max(1, min(minutes, IMPERSONATION_MAX_MINUTES))
    now = datetime.now(UTC)
    expire = now + timedelta(minutes=minutes)
    payload: dict = {
        "sub": str(target.id),
        "type": "impersonation",
        "imp": str(actor.id),
        "imp_email": actor.email,
        "jti": uuid.uuid4().hex,
        "iat": now,
        "exp": expire,
    }
    return jwt_encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def parse_impersonation_token(token: str) -> dict | None:
    """若 token 為 impersonation token、回傳 claims；否則 None。"""
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None
    if payload.get("type") != "impersonation":
        return None
    return payload


async def record_start(
    db: AsyncSession,
    *,
    actor: User,
    target_user_id: uuid.UUID,
    minutes: int,
    ip_address: str | None,
) -> None:
    await audit_chain.write_audit_log_with_chain(
        db,
        entity_type="user",
        entity_id=str(target_user_id),
        action="impersonate_start",
        actor_id=str(actor.id),
        actor_email=actor.email,
        meta={"minutes": minutes},
        ip_address=ip_address,
        summary=f"管理員 {actor.email} 開始 impersonate user_id={target_user_id}",
    )


async def record_end(
    db: AsyncSession,
    *,
    actor_id: str,
    actor_email: str | None,
    target_user_id: str,
    reason: str,
) -> None:
    await audit_chain.write_audit_log_with_chain(
        db,
        entity_type="user",
        entity_id=target_user_id,
        action="impersonate_end",
        actor_id=actor_id,
        actor_email=actor_email,
        meta={"reason": reason},
        summary=f"impersonation 結束 ({reason})",
    )


async def record_blocked_write(
    db: AsyncSession,
    *,
    actor_id: str,
    target_user_id: str,
    method: str,
    path: str,
) -> None:
    """impersonation 期間試圖寫入 → 擋掉並寫入 audit log。"""
    await audit_chain.write_audit_log_with_chain(
        db,
        entity_type="user",
        entity_id=target_user_id,
        action="impersonate_write_blocked",
        actor_id=actor_id,
        meta={"method": method, "path": path},
        summary=f"impersonation 期間試圖寫入 {method} {path}（已拒絕）",
    )


__all__ = [
    "IMPERSONATION_DEFAULT_MINUTES",
    "IMPERSONATION_MAX_MINUTES",
    "ImpersonationError",
    "create_impersonation_token",
    "parse_impersonation_token",
    "record_blocked_write",
    "record_end",
    "record_start",
]
