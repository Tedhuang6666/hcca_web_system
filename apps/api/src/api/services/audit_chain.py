"""稽核日誌雜湊鏈 helper，對應 ADR-004。

提供：
- compute_self_hash(): 計算單一 AuditLog row 的 self_hash
- get_last_hash(): 取上一筆 self_hash（chain 起點為 GENESIS）
- write_audit_log_with_chain(): 寫入新紀錄 + 自動計算 prev_hash/self_hash
- verify_integrity_range(): 重算指定範圍 hash 並比對

新紀錄使用版本化 HMAC-SHA-256；舊版 SHA-256 僅供相容驗證
canonical form：JSON sorted_keys，包含 prev_hash，不含 self_hash

注意：
- write 必須序列化（透過 SELECT ... FOR UPDATE on 最後一筆）
  避免並發寫入導致 chain 斷裂
- 此設計不防「事件根本沒寫進 audit log」（service 層繞過）
  → 仍依賴 code review + RBAC 防護
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import advisory_xact_lock
from api.models.audit_log import AuditLog

GENESIS_HASH = "GENESIS" + "0" * 56  # 64 chars to match SHA-256 hex length
_HMAC_PREFIX = "hmac-sha256:v1:"
_LEGACY_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_VERSIONED_HASH_RE = re.compile(r"^hmac-sha256:v1:([A-Za-z0-9_-]{1,16}):([0-9a-f]{64})$")
# Serialize every chain writer in PostgreSQL.  The lock is transaction-scoped and
# is a no-op for the SQLite test database.
AUDIT_CHAIN_LOCK_KEY = 0x48434341


class AuditChainIntegrityError(RuntimeError):
    """稽核鏈缺漏、格式無法辨識或驗證失敗，拒絕接續寫入。"""


def _normalize_created_at(value: datetime) -> str:
    """以 UTC microsecond-truncated ISO 字串作為 canonical 表示。

    SQLite / 部分 driver 在 round-trip 後可能丟失 tzinfo 或截斷精度，
    這裡統一處理：有 tz → 轉 UTC、無 tz → 視為 UTC、再 truncate microseconds。
    """
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    # 截到 millisecond 避免 SQLite 與 PG 對 microsecond 處理差異
    value = value.replace(microsecond=(value.microsecond // 1000) * 1000)
    return value.isoformat()


def _canonical_payload(
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: str | None,
    actor_email: str | None,
    meta: dict,
    ip_address: str | None,
    created_at: datetime,
    summary: str | None,
    prev_hash: str,
) -> str:
    """把 AuditLog 內容序列化為 canonical 字串。

    決定性：欄位順序固定、JSON sort_keys、datetime 統一 UTC 並截 ms、不含 self_hash。
    """
    payload = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "actor_id": actor_id,
        "actor_email": actor_email,
        "meta": meta,
        "ip_address": ip_address,
        "created_at": _normalize_created_at(created_at),
        "summary": summary,
        "prev_hash": prev_hash,
    }
    return json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)


def _canonical_row(row: AuditLog, prev_hash: str) -> bytes:
    canonical = _canonical_payload(
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        action=row.action,
        actor_id=row.actor_id,
        actor_email=row.actor_email,
        meta=row.meta or {},
        ip_address=row.ip_address,
        created_at=row.created_at,
        summary=row.summary,
        prev_hash=prev_hash,
    )
    return canonical.encode("utf-8")


def compute_legacy_self_hash(row: AuditLog, prev_hash: str) -> str:
    """計算升級前無金鑰 SHA-256，僅供相容驗證舊紀錄。"""
    return hashlib.sha256(_canonical_row(row, prev_hash)).hexdigest()


def _audit_chain_keys() -> dict[str, str]:
    keys: dict[str, str] = {}
    for item in settings.AUDIT_CHAIN_PREVIOUS_SIGNING_KEYS:
        kid, _, key = item.partition(":")
        keys[kid] = key
    active_key = settings.AUDIT_CHAIN_SIGNING_KEY or settings.SECRET_KEY
    keys[settings.AUDIT_CHAIN_ACTIVE_KID] = active_key
    return keys


def compute_self_hash(row: AuditLog, prev_hash: str) -> str:
    """使用目前版本及 active key 計算版本化 HMAC-SHA-256。"""
    key = _audit_chain_keys()[settings.AUDIT_CHAIN_ACTIVE_KID].encode("utf-8")
    digest = hmac.new(key, _canonical_row(row, prev_hash), hashlib.sha256).hexdigest()
    return f"{_HMAC_PREFIX}{settings.AUDIT_CHAIN_ACTIVE_KID}:{digest}"


def compute_expected_self_hash(row: AuditLog, prev_hash: str, stored_hash: str) -> str | None:
    """依儲存的 hash 格式驗算；未知版本或 key id 回傳 None。"""
    canonical = _canonical_row(row, prev_hash)
    if _LEGACY_HASH_RE.fullmatch(stored_hash):
        return hashlib.sha256(canonical).hexdigest()

    match = _VERSIONED_HASH_RE.fullmatch(stored_hash)
    if match is None:
        return None
    kid, _ = match.groups()
    key = _audit_chain_keys().get(kid)
    if key is None:
        return None
    digest = hmac.new(key.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return f"{_HMAC_PREFIX}{kid}:{digest}"


async def get_last_hash(db: AsyncSession) -> str:
    """取最後一筆 AuditLog 的 self_hash；無紀錄回 GENESIS_HASH。

    呼叫端在寫入新紀錄前用此值作為 prev_hash。
    為避免並發寫入產生分叉、呼叫端應在交易中對「最後一筆」加鎖
    （SELECT ... FOR UPDATE），或用 advisory lock。

    不修改既有資料。最後一筆缺 hash、格式未知或驗證失敗時拒絕接續，
    避免寫入路徑靜默重簽已缺漏／受竄改的稽核紀錄。
    """
    stmt = select(AuditLog).order_by(desc(AuditLog.created_at), desc(AuditLog.id)).limit(1)
    result = await db.execute(stmt)
    last = result.scalar_one_or_none()
    if last is None:
        return GENESIS_HASH
    if not last.prev_hash or not last.self_hash:
        raise AuditChainIntegrityError("latest audit log has a missing chain hash")
    expected = compute_expected_self_hash(last, last.prev_hash, last.self_hash)
    if expected is None:
        raise AuditChainIntegrityError("latest audit log hash version or key is unknown")
    if not hmac.compare_digest(expected, last.self_hash):
        raise AuditChainIntegrityError("latest audit log hash verification failed")
    return last.self_hash


async def write_audit_log_with_chain(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: str | None = None,
    actor_email: str | None = None,
    meta: dict[str, Any] | None = None,
    ip_address: str | None = None,
    summary: str | None = None,
) -> AuditLog:
    """寫入新 AuditLog、含 prev_hash/self_hash 計算。

    呼叫端應在交易內呼叫；本函式不 commit。
    """
    await advisory_xact_lock(db, AUDIT_CHAIN_LOCK_KEY)
    prev_hash = await get_last_hash(db)
    now = datetime.now(UTC)
    row = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        actor_email=actor_email,
        meta=meta or {},
        ip_address=ip_address,
        created_at=now,
        summary=summary,
    )
    # 計算 self_hash（依賴 row 上的 created_at 已設好）
    self_hash = compute_self_hash(row, prev_hash)

    row.prev_hash = prev_hash
    row.self_hash = self_hash

    db.add(row)
    await db.flush()
    return row


async def verify_integrity_range(
    db: AsyncSession,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[dict[str, Any]]:
    """檢查指定範圍的 hash chain 完整性。

    回傳一個 list，每個 element 是發現的不一致：
        {"audit_log_id": ..., "expected_hash": ..., "actual_hash": ...}

    空 list 代表全部通過。

    呼叫端通常是 Celery beat 每週六 03:00 跑全表掃描。
    """
    stmt = select(AuditLog).order_by(AuditLog.created_at, AuditLog.id)
    if since is not None:
        stmt = stmt.where(AuditLog.created_at >= since)
    if until is not None:
        stmt = stmt.where(AuditLog.created_at < until)

    result = await db.execute(stmt)
    rows = result.scalars().all()

    issues: list[dict[str, Any]] = []
    prev_hash: str | None = GENESIS_HASH if since is None else None

    for row in rows:
        # since 範圍的首筆沿用儲存的連結；完整掃描則從 GENESIS 驗證每個連結。
        expected_prev = row.prev_hash if prev_hash is None else prev_hash
        if expected_prev is None:
            expected_prev = GENESIS_HASH
        if row.prev_hash != expected_prev:
            issues.append(
                {
                    "audit_log_id": str(row.id),
                    "expected_hash": None,
                    "actual_hash": row.self_hash,
                    "created_at": row.created_at.isoformat(),
                    "reason": "prev_hash mismatch (chain link broken)",
                }
            )

        expected_self = (
            compute_expected_self_hash(row, row.prev_hash, row.self_hash)
            if row.prev_hash and row.self_hash
            else None
        )
        if expected_self is None or not hmac.compare_digest(expected_self, row.self_hash or ""):
            issues.append(
                {
                    "audit_log_id": str(row.id),
                    "expected_hash": expected_self,
                    "actual_hash": row.self_hash,
                    "created_at": row.created_at.isoformat(),
                    "reason": (
                        "missing or unsupported hash version/key"
                        if expected_self is None
                        else "self_hash mismatch (content tampered)"
                    ),
                }
            )

        prev_hash = row.self_hash

    return issues


__all__ = [
    "GENESIS_HASH",
    "AUDIT_CHAIN_LOCK_KEY",
    "AuditChainIntegrityError",
    "compute_self_hash",
    "compute_legacy_self_hash",
    "compute_expected_self_hash",
    "get_last_hash",
    "verify_integrity_range",
    "write_audit_log_with_chain",
]
