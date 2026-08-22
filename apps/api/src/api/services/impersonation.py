"""Admin Impersonation，參見 docs/iso27001/E-access-control.md。

行為：
- 管理員（持 admin:impersonate）可申請以另一 user 身分檢視
- 產生短效（預設 30 分鐘）impersonation token：JWT 內含 sub=target、imp=actor
- 前端帶此 token 呼叫 API，下游一律以 target 身分看資料
- 依 target 的實際權限允許讀寫
- 完整 audit log：開始 / 代行修改 / 結束，修改紀錄標註 actor 管理員

模型上不存新表（純 JWT-based）；audit log 使用既有 AuditLog。
"""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.security import create_signed_token, decode_token
from api.models.user import User
from api.services import audit_chain

logger = logging.getLogger(__name__)

IMPERSONATION_DEFAULT_MINUTES = 30
IMPERSONATION_MAX_MINUTES = 60


class ImpersonationError(RuntimeError):
    """impersonation 流程錯誤的統一例外。"""


@dataclass(frozen=True, slots=True)
class ImpersonationContext:
    """目前請求的代行雙重身分，供稽核層統一標註。"""

    actor_id: str
    actor_email: str | None
    actor_display_name: str | None
    target_user_id: str
    target_email: str | None
    target_display_name: str | None

    @property
    def actor_label(self) -> str:
        return self.actor_display_name or self.actor_email or self.actor_id


_current_context: ContextVar[ImpersonationContext | None] = ContextVar(
    "hcca_impersonation_context", default=None
)


def set_impersonation_context(context: ImpersonationContext) -> Token[ImpersonationContext | None]:
    return _current_context.set(context)


def reset_impersonation_context(token: Token[ImpersonationContext | None]) -> None:
    _current_context.reset(token)


def impersonation_context_from_claims(claims: dict) -> ImpersonationContext | None:
    actor_id = claims.get("imp")
    target_user_id = claims.get("sub")
    if not actor_id or not target_user_id:
        return None
    return ImpersonationContext(
        actor_id=str(actor_id),
        actor_email=claims.get("imp_email"),
        actor_display_name=claims.get("imp_name"),
        target_user_id=str(target_user_id),
        target_email=claims.get("target_email"),
        target_display_name=claims.get("target_name"),
    )


def annotate_audit_fields(
    *,
    actor_id: str | None,
    actor_email: str | None,
    meta: dict[str, Any] | None,
    summary: str | None,
) -> tuple[str | None, str | None, dict[str, Any], str | None]:
    """將目前請求的代行者與目標身分寫入既有 audit 欄位。"""
    context = _current_context.get()
    if context is None:
        return actor_id, actor_email, dict(meta or {}), summary

    enriched_meta = dict(meta or {})
    enriched_meta["impersonation"] = {
        "actor_id": context.actor_id,
        "actor_email": context.actor_email,
        "actor_display_name": context.actor_display_name,
        "target_user_id": context.target_user_id,
        "target_email": context.target_email,
        "target_display_name": context.target_display_name,
        "note": f"由 {context.actor_label} 管理員代行",
    }
    note = f"（由 {context.actor_label} 管理員代行）"
    enriched_summary = (
        summary if summary and "管理員代行" in summary else f"{summary or '操作'} {note}"
    )
    return (
        actor_id or context.target_user_id,
        actor_email or context.target_email,
        enriched_meta,
        enriched_summary,
    )


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
    payload: dict = {
        "sub": str(target.id),
        "type": "impersonation",
        "imp": str(actor.id),
        "imp_email": actor.email,
        "imp_name": actor.display_name,
        "target_email": target.email,
        "target_name": target.display_name,
        "jti": uuid.uuid4().hex,
    }
    return create_signed_token(payload, timedelta(minutes=minutes))


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
    "ImpersonationContext",
    "ImpersonationError",
    "annotate_audit_fields",
    "create_impersonation_token",
    "impersonation_context_from_claims",
    "parse_impersonation_token",
    "record_blocked_write",
    "record_end",
    "record_start",
    "reset_impersonation_context",
    "set_impersonation_context",
]
