"""資料生命週期 — 批次壓縮歸檔（archive）與清理（purge）。

設計：
  - **規則表硬編碼**：每條規則指定一張表、過濾條件、預設保留天數、是否需 archive 才能 purge。
    放硬編碼是刻意的；新加表時需明確評估保留期、隱私風險、外鍵影響，由工程師決定，
    再讓非工程師接手者於 UI 觸發 dry-run / execute。
  - **Archive 格式**：每批次寫成 `uploads/archives/{yyyy}/{mm}/{rule_id}/{batch_id}.jsonl.gz`，
    每行一筆 JSON；含 metadata header 行。
  - **Dry-run 必經**：UI 永遠先 dry-run（只回筆數與 sample），人類確認後再 execute。
  - **Audit 必寫**：每次 execute（不論結果）都寫 audit_log，含 rule_id、筆數、檔案路徑。
  - **冪等**：execute 期間中斷可重跑（用 PK ranges 確定下次從哪繼續）。本檔採「逐批 select-and-delete」
    在單一 DB 事務內，避免半成品。

非目標：
  - 不替代備份（archive 是「移出 DB」，備份是「DB 完整快照」）。
  - 不處理 user PII 清理（請走 `/admin/privacy`）。
  - 不直接刪除任何業務「主資料」（公文、法規、組織等）。
"""

from __future__ import annotations

import gzip
import json
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from api.core.config import settings

logger = logging.getLogger(__name__)

ArchiveAction = Literal["archive", "purge", "archive_then_purge"]


@dataclass(frozen=True)
class LifecycleRule:
    """單條清理規則。

    where_builder 接受 (model_cls, cutoff_datetime) 並回傳 SQLAlchemy where 條件。
    cutoff = now - retention_days；該日期之前建立的紀錄符合清理條件。
    """

    id: str  # 唯一識別（API 路徑用）
    label: str  # 中文顯示名
    description: str  # 中文說明
    model_path: str  # "api.models.notification:Notification"
    default_retention_days: int
    min_retention_days: int  # UI 不允許低於此值（防止誤操作）
    timestamp_field: str  # 取 cutoff 條件的欄位名
    extra_filter: str | None = None  # 中文說明用（不參與邏輯，靠 where_builder）
    default_action: ArchiveAction = "archive_then_purge"
    danger_level: Literal["safe", "caution", "dangerous"] = "caution"
    affects_modules: Sequence[str] = field(default_factory=tuple)


# ── 規則表（新增表時在此擴增）────────────────────────────────────────────────
RULES: list[LifecycleRule] = [
    LifecycleRule(
        id="notification_read_old",
        label="已讀通知（過舊）",
        description="使用者已讀且超過保留天數的站內通知；通常無回顧價值。",
        model_path="api.models.notification:Notification",
        default_retention_days=90,
        min_retention_days=30,
        timestamp_field="created_at",
        extra_filter="僅 is_read = true",
        default_action="purge",  # 已讀通知直接刪除不歸檔
        danger_level="safe",
        affects_modules=("notifications",),
    ),
    LifecycleRule(
        id="outbox_processed_old",
        label="已處理 Outbox 事件",
        description="status=processed 且超過保留天數的 outbox 事件；只是傳遞痕跡，可清。",
        model_path="api.models.outbox:OutboxEvent",
        default_retention_days=30,
        min_retention_days=7,
        timestamp_field="processed_at",
        extra_filter="僅 status = 'processed'",
        default_action="purge",
        danger_level="safe",
        affects_modules=("notifications", "discord", "line"),
    ),
    LifecycleRule(
        id="outbox_dead_old",
        label="Outbox 失敗事件（dead）",
        description="status=dead 的事件代表通知未送達；archive 後可清以避免 dashboard 雜訊。",
        model_path="api.models.outbox:OutboxEvent",
        default_retention_days=90,
        min_retention_days=30,
        timestamp_field="created_at",
        extra_filter="僅 status = 'dead'",
        default_action="archive_then_purge",
        danger_level="caution",
        affects_modules=("notifications",),
    ),
    LifecycleRule(
        id="email_messages_sent_old",
        label="已寄送 / 失敗 / 已取消的 Email 紀錄",
        description="status ∈ {sent, failed, cancelled} 且超過保留天數的寄信紀錄。"
        "包含 resolved_emails，請先 archive 再 purge。",
        model_path="api.models.email_message:EmailMessage",
        default_retention_days=365,
        min_retention_days=180,
        timestamp_field="created_at",
        extra_filter="僅 status ∈ {sent, failed, cancelled}",
        default_action="archive_then_purge",
        danger_level="caution",
        affects_modules=("email",),
    ),
    LifecycleRule(
        id="audit_logs_old",
        label="稽核日誌（過 3 年）",
        description="超過 3 年的稽核紀錄；archive 後可清。"
        "公文 / 法規等業務相關 audit 屬法律應保存期 7 年內者請勿動。",
        model_path="api.models.audit_log:AuditLog",
        default_retention_days=1095,
        min_retention_days=1095,  # 不允許短於 3 年
        timestamp_field="created_at",
        extra_filter=None,
        default_action="archive_then_purge",
        danger_level="dangerous",
        affects_modules=("audit",),
    ),
]


RULES_BY_ID: dict[str, LifecycleRule] = {r.id: r for r in RULES}


def get_rule(rule_id: str) -> LifecycleRule:
    rule = RULES_BY_ID.get(rule_id)
    if rule is None:
        raise ValueError(f"未知的生命週期規則：{rule_id}")
    return rule


# ── Model 解析 ───────────────────────────────────────────────────────────────


def _resolve_model(rule: LifecycleRule) -> type:
    import importlib

    module_name, class_name = rule.model_path.split(":")
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


def _ts_column(rule: LifecycleRule, model: type) -> ColumnElement:
    col = getattr(model, rule.timestamp_field)
    return col


def _build_where(rule: LifecycleRule, model: type, cutoff: datetime) -> tuple[ColumnElement, ...]:
    """組合 where 條件（按 rule id 走專屬的額外條件）。"""
    ts = _ts_column(rule, model)
    base = ts.is_not(None), ts < cutoff
    if rule.id == "notification_read_old":
        return (*base, model.is_read.is_(True))  # type: ignore[attr-defined]
    if rule.id == "outbox_processed_old":
        from api.models.outbox import OutboxStatus

        return (*base, model.status == OutboxStatus.PROCESSED)  # type: ignore[attr-defined]
    if rule.id == "outbox_dead_old":
        from api.models.outbox import OutboxStatus

        return (*base, model.status == OutboxStatus.DEAD)  # type: ignore[attr-defined]
    if rule.id == "email_messages_sent_old":
        from api.models.email_message import EmailStatus

        return (
            *base,
            model.status.in_(  # type: ignore[attr-defined]
                [EmailStatus.SENT, EmailStatus.FAILED, EmailStatus.CANCELLED]
            ),
        )
    return base


# ── 序列化 ─────────────────────────────────────────────────────────────────


def _serialize_row(obj: Any) -> dict[str, Any]:
    """將 ORM 物件轉成 JSON-safe dict（含 datetime/UUID/Enum 字串化）。"""
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        v = getattr(obj, col.name)
        if isinstance(v, datetime):
            out[col.name] = v.isoformat()
        elif isinstance(v, uuid.UUID):
            out[col.name] = str(v)
        elif hasattr(v, "value") and hasattr(type(v), "__members__"):
            out[col.name] = str(v.value)
        else:
            out[col.name] = v
    return out


# ── Archive 路徑 ────────────────────────────────────────────────────────────


def archive_root() -> Path:
    base = Path(getattr(settings, "DB_BACKUP_DIR", "uploads/backups")).parent
    root = base / "archives"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _archive_path_for(rule_id: str, when: datetime) -> tuple[Path, str]:
    rule = RULES_BY_ID.get(rule_id)
    if rule is None:
        raise ValueError(f"未知規則：{rule_id}")
    batch_id = uuid.uuid4().hex[:12]
    root = archive_root()
    sub = root / f"{when.year:04d}" / f"{when.month:02d}" / rule.id
    sub.mkdir(parents=True, exist_ok=True)
    return sub / f"{batch_id}.jsonl.gz", batch_id


def list_archives() -> list[dict[str, Any]]:
    """列出所有歸檔檔案（UI 用）。"""
    root = archive_root()
    if not root.exists():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted(root.rglob("*.jsonl.gz")):
        try:
            stat = p.stat()
            rel = p.relative_to(root)
            out.append(
                {
                    "path": str(rel),
                    "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, UTC).isoformat(),
                }
            )
        except OSError:
            continue
    out.sort(key=lambda x: x["modified_at"], reverse=True)
    return out


def resolve_archive_file(relative_path: str) -> Path:
    root = archive_root()
    normalized = relative_path.replace("\\", "/")
    for archive_file in root.rglob("*.jsonl.gz"):
        if archive_file.relative_to(root).as_posix() == normalized and archive_file.is_file():
            return archive_file
    raise FileNotFoundError(relative_path)


def read_archive(relative_path: str, limit: int = 100) -> list[dict[str, Any]]:
    """讀取 archive 檔案的前 N 行（含 metadata header）。UI 預覽用。"""
    target = resolve_archive_file(relative_path)
    rows: list[dict[str, Any]] = []
    with gzip.open(target, "rt", encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            if i >= limit:
                break
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


# ── Preview / Execute ───────────────────────────────────────────────────────


@dataclass
class PreviewResult:
    rule_id: str
    retention_days: int
    cutoff_at: datetime
    matched_count: int
    sample: list[dict[str, Any]]  # 最多 5 筆 sample


@dataclass
class ExecuteResult:
    rule_id: str
    action: ArchiveAction
    retention_days: int
    cutoff_at: datetime
    matched_count: int
    archived_count: int
    purged_count: int
    archive_file: str | None
    started_at: datetime
    finished_at: datetime


async def preview(
    session: AsyncSession,
    *,
    rule_id: str,
    retention_days: int | None = None,
) -> PreviewResult:
    rule = get_rule(rule_id)
    days = retention_days if retention_days is not None else rule.default_retention_days
    if days < rule.min_retention_days:
        raise ValueError(f"保留天數 {days} 低於本規則下限 {rule.min_retention_days}（避免誤操作）")
    cutoff = datetime.now(UTC) - timedelta(days=days)
    model = _resolve_model(rule)
    where = _build_where(rule, model, cutoff)

    count_stmt = select(func.count()).select_from(model).where(*where)
    matched = int((await session.execute(count_stmt)).scalar_one())

    sample_stmt = select(model).where(*where).limit(5)
    rows = (await session.execute(sample_stmt)).scalars().all()
    sample = [_serialize_row(r) for r in rows]
    return PreviewResult(
        rule_id=rule_id,
        retention_days=days,
        cutoff_at=cutoff,
        matched_count=matched,
        sample=sample,
    )


async def execute(
    session: AsyncSession,
    *,
    rule_id: str,
    action: ArchiveAction | None = None,
    retention_days: int | None = None,
    batch_size: int = 1000,
    max_batches: int = 100,
) -> ExecuteResult:
    """一輪執行；超過 max_batches × batch_size 筆則停下避免單次過久，下次再跑會接著做。"""
    rule = get_rule(rule_id)
    chosen_action: ArchiveAction = action or rule.default_action
    days = retention_days if retention_days is not None else rule.default_retention_days
    if days < rule.min_retention_days:
        raise ValueError(f"保留天數 {days} 低於本規則下限 {rule.min_retention_days}（避免誤操作）")
    started = datetime.now(UTC)
    cutoff = started - timedelta(days=days)
    model = _resolve_model(rule)
    where = _build_where(rule, model, cutoff)

    archive_file: Path | None = None
    archived = 0
    purged = 0
    matched_total = int(
        (await session.execute(select(func.count()).select_from(model).where(*where))).scalar_one()
    )

    fh = None
    if chosen_action in ("archive", "archive_then_purge") and matched_total > 0:
        archive_file, batch_id = _archive_path_for(rule_id, started)
        fh = gzip.open(archive_file, "wt", encoding="utf-8")  # noqa: SIM115 closed in finally
        header = {
            "_metadata": True,
            "rule_id": rule_id,
            "rule_label": rule.label,
            "retention_days": days,
            "cutoff_at": cutoff.isoformat(),
            "started_at": started.isoformat(),
            "batch_id": batch_id,
        }
        fh.write(json.dumps(header, ensure_ascii=False) + "\n")

    try:
        for _batch in range(max_batches):
            batch_stmt = select(model).where(*where).limit(batch_size)
            rows = (await session.execute(batch_stmt)).scalars().all()
            if not rows:
                break

            if fh is not None:
                for row in rows:
                    fh.write(json.dumps(_serialize_row(row), ensure_ascii=False) + "\n")
                archived += len(rows)

            if chosen_action in ("purge", "archive_then_purge"):
                pk_col = model.__table__.primary_key.columns.values()[0]
                ids = [getattr(r, pk_col.name) for r in rows]
                del_stmt = delete(model).where(pk_col.in_(ids))
                res = await session.execute(del_stmt)
                purged += int(res.rowcount or 0)
            else:
                # 只 archive：不刪資料；為避免本迴圈無限取同一批，退出
                break
            await session.flush()
    finally:
        if fh is not None:
            fh.close()

    finished = datetime.now(UTC)
    logger.info(
        "Lifecycle execute rule=%s action=%s matched=%d archived=%d purged=%d file=%s",
        rule_id,
        chosen_action,
        matched_total,
        archived,
        purged,
        archive_file,
    )
    return ExecuteResult(
        rule_id=rule_id,
        action=chosen_action,
        retention_days=days,
        cutoff_at=cutoff,
        matched_count=matched_total,
        archived_count=archived,
        purged_count=purged,
        archive_file=str(archive_file.relative_to(archive_root())) if archive_file else None,
        started_at=started,
        finished_at=finished,
    )


# ── Rules listing for UI ────────────────────────────────────────────────────


async def list_rules_with_counts(session: AsyncSession) -> list[dict[str, Any]]:
    """列出所有規則 + 預估目前可清理筆數（按 default_retention_days）。"""
    out: list[dict[str, Any]] = []
    now = datetime.now(UTC)
    for rule in RULES:
        cutoff = now - timedelta(days=rule.default_retention_days)
        model = _resolve_model(rule)
        where = _build_where(rule, model, cutoff)
        try:
            count = int(
                (
                    await session.execute(select(func.count()).select_from(model).where(*where))
                ).scalar_one()
            )
        except Exception:
            logger.exception("count_rule_failed rule=%s", rule.id)
            count = -1
        out.append(
            {
                "id": rule.id,
                "label": rule.label,
                "description": rule.description,
                "default_retention_days": rule.default_retention_days,
                "min_retention_days": rule.min_retention_days,
                "default_action": rule.default_action,
                "danger_level": rule.danger_level,
                "extra_filter": rule.extra_filter,
                "affects_modules": list(rule.affects_modules),
                "matched_count": count,
            }
        )
    return out
