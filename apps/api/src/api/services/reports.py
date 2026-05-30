"""預寫常用報表 — 10 個固定查詢，read-only。

設計：
  - 每個報表是一個 async function，回傳 list[dict]（每筆為一行）。
  - 內建 LIMIT 避免巨大結果集；UI 顯示為表格 + 提供 CSV 匯出。
  - 不允許自由 SQL，避免 injection 與「接手者看不懂 schema」風險。
  - 新增報表只需在 REPORTS 註冊。
"""

from __future__ import annotations

import csv
import io
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReportSpec:
    id: str
    label: str
    description: str
    runner: Callable[[AsyncSession], Any]  # async callable -> list[dict]


# ── 各報表實作 ──────────────────────────────────────────────────────────────


async def _r_recently_active_users(session: AsyncSession) -> list[dict[str, Any]]:
    """過去 30 天 audit_log 中出現過的 user_email 與 action 計數。"""
    from api.models.audit_log import AuditLog

    cutoff = datetime.now(UTC) - timedelta(days=30)
    stmt = (
        select(
            AuditLog.actor_email,
            func.count().label("event_count"),
            func.max(AuditLog.created_at).label("last_seen"),
        )
        .where(AuditLog.actor_email.is_not(None))
        .where(AuditLog.created_at >= cutoff)
        .group_by(AuditLog.actor_email)
        .order_by(func.count().desc())
        .limit(200)
    )
    rows = (await session.execute(stmt)).all()
    return [{"email": r[0], "event_count": int(r[1]), "last_seen": r[2].isoformat()} for r in rows]


async def _r_pending_documents_top(session: AsyncSession) -> list[dict[str, Any]]:
    """待簽公文 Top 20（按建立時間最舊優先）。"""
    try:
        from api.models.document import Document, DocumentStatus
    except Exception:
        return []
    stmt = (
        select(
            Document.id,
            Document.title,
            Document.status,
            Document.created_at,
            Document.created_by,
        )
        .where(Document.status.in_([DocumentStatus.UNDER_REVIEW, DocumentStatus.DRAFT]))
        .order_by(Document.created_at.asc())
        .limit(20)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "status": str(r[2]),
            "created_at": r[3].isoformat() if r[3] else None,
            "created_by": str(r[4]) if r[4] else None,
        }
        for r in rows
    ]


async def _r_expired_active_positions(session: AsyncSession) -> list[dict[str, Any]]:
    """end_date < today 但仍可能被視為活躍（按 end_date 倒序，最近過期優先）。"""
    from api.models.org import Org, Position, UserPosition
    from api.models.user import User

    today = datetime.now(UTC).date()
    stmt = (
        select(
            UserPosition.id,
            User.email,
            Position.name,
            Org.name,
            UserPosition.start_date,
            UserPosition.end_date,
        )
        .join(User, UserPosition.user_id == User.id)
        .join(Position, UserPosition.position_id == Position.id)
        .join(Org, Position.org_id == Org.id)
        .where(UserPosition.end_date.is_not(None))
        .where(UserPosition.end_date < today)
        .order_by(UserPosition.end_date.desc())
        .limit(200)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "user_position_id": str(r[0]),
            "user_email": r[1],
            "position": r[2],
            "org": r[3],
            "start_date": r[4].isoformat(),
            "end_date": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


async def _r_recent_signups(session: AsyncSession) -> list[dict[str, Any]]:
    """過去 7 天新註冊使用者。"""
    from api.models.user import User

    cutoff = datetime.now(UTC) - timedelta(days=7)
    stmt = (
        select(User.id, User.email, User.display_name, User.created_at, User.is_active)
        .where(User.created_at >= cutoff)
        .order_by(User.created_at.desc())
        .limit(200)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(r[0]),
            "email": r[1],
            "display_name": r[2],
            "created_at": r[3].isoformat(),
            "is_active": r[4],
        }
        for r in rows
    ]


async def _r_outbox_dead_letters(session: AsyncSession) -> list[dict[str, Any]]:
    """Outbox dead letter（通知未送達）。"""
    from api.models.outbox import OutboxEvent, OutboxStatus

    stmt = (
        select(
            OutboxEvent.id,
            OutboxEvent.event_type,
            OutboxEvent.retry_count,
            OutboxEvent.last_error,
            OutboxEvent.created_at,
        )
        .where(OutboxEvent.status == OutboxStatus.DEAD)
        .order_by(OutboxEvent.created_at.desc())
        .limit(100)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(r[0]),
            "event_type": r[1],
            "retry_count": int(r[2]),
            "last_error": (r[3] or "")[:300],
            "created_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


async def _r_email_volume_daily(session: AsyncSession) -> list[dict[str, Any]]:
    """過去 30 天 Email 寄送量（依日期）。"""
    try:
        from api.models.email_message import EmailMessage
    except Exception:
        return []
    cutoff = datetime.now(UTC) - timedelta(days=30)
    day = func.date(EmailMessage.created_at).label("day")
    stmt = (
        select(day, EmailMessage.status, func.count().label("count"))
        .where(EmailMessage.created_at >= cutoff)
        .group_by(day, EmailMessage.status)
        .order_by(day.desc())
        .limit(500)
    )
    rows = (await session.execute(stmt)).all()
    return [{"day": str(r[0]), "status": str(r[1]), "count": int(r[2])} for r in rows]


async def _r_audit_event_volume_daily(session: AsyncSession) -> list[dict[str, Any]]:
    """過去 30 天稽核事件量（依日期 + entity_type）。"""
    from api.models.audit_log import AuditLog

    cutoff = datetime.now(UTC) - timedelta(days=30)
    day = func.date(AuditLog.created_at).label("day")
    stmt = (
        select(day, AuditLog.entity_type, func.count().label("count"))
        .where(AuditLog.created_at >= cutoff)
        .group_by(day, AuditLog.entity_type)
        .order_by(day.desc(), func.count().desc())
        .limit(1000)
    )
    rows = (await session.execute(stmt)).all()
    return [{"day": str(r[0]), "entity_type": r[1], "count": int(r[2])} for r in rows]


async def _r_inactive_users_no_positions(session: AsyncSession) -> list[dict[str, Any]]:
    """is_active 但「無任何 active user_position」的使用者（可能該降權）。"""
    from api.models.org import UserPosition
    from api.models.user import User

    today = datetime.now(UTC).date()
    # 找出 today 仍有效任期的 user_id
    active_user_ids = select(UserPosition.user_id).where(
        UserPosition.start_date <= today,
        (UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today),
    )
    stmt = (
        select(User.id, User.email, User.display_name, User.created_at)
        .where(User.is_active.is_(True))
        .where(User.id.not_in(active_user_ids))
        .where(User.is_superuser.is_(False))
        .order_by(User.created_at.desc())
        .limit(500)
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(r[0]),
            "email": r[1],
            "display_name": r[2],
            "created_at": r[3].isoformat(),
        }
        for r in rows
    ]


async def _r_superuser_list(session: AsyncSession) -> list[dict[str, Any]]:
    """目前所有 superuser（每月檢查）。"""
    from api.models.user import User

    stmt = (
        select(User.id, User.email, User.display_name, User.is_active, User.created_at)
        .where(User.is_superuser.is_(True))
        .order_by(User.created_at.asc())
    )
    rows = (await session.execute(stmt)).all()
    return [
        {
            "id": str(r[0]),
            "email": r[1],
            "display_name": r[2],
            "is_active": r[3],
            "created_at": r[4].isoformat(),
        }
        for r in rows
    ]


async def _r_orgs_position_summary(session: AsyncSession) -> list[dict[str, Any]]:
    """各組織職位數 / 現任人數摘要。"""
    from api.models.org import Org, Position, UserPosition

    today = datetime.now(UTC).date()
    stmt = (
        select(
            Org.id,
            Org.name,
            func.count(func.distinct(Position.id)).label("position_count"),
        )
        .join(Position, Position.org_id == Org.id, isouter=True)
        .where(Org.is_active.is_(True))
        .group_by(Org.id, Org.name)
        .order_by(Org.name.asc())
    )
    orgs = (await session.execute(stmt)).all()

    holders_stmt = (
        select(Position.org_id, func.count(func.distinct(UserPosition.user_id)))
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.start_date <= today)
        .where((UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today))
        .group_by(Position.org_id)
    )
    holders_map: dict[Any, int] = {
        r[0]: int(r[1]) for r in (await session.execute(holders_stmt)).all()
    }
    return [
        {
            "org_id": str(r[0]),
            "org_name": r[1],
            "position_count": int(r[2] or 0),
            "active_holders": holders_map.get(r[0], 0),
        }
        for r in orgs
    ]


# ── 註冊表 ────────────────────────────────────────────────────────────────

REPORTS: list[ReportSpec] = [
    ReportSpec(
        id="recently_active_users",
        label="近 30 天活躍使用者",
        description="audit_log 中出現過的使用者，按事件數排序",
        runner=_r_recently_active_users,
    ),
    ReportSpec(
        id="pending_documents_top",
        label="待簽公文 Top 20",
        description="DRAFT / UNDER_REVIEW 狀態，按建立時間最舊優先",
        runner=_r_pending_documents_top,
    ),
    ReportSpec(
        id="expired_active_positions",
        label="已過期的任期記錄",
        description="end_date < today 的 user_position（檢查是否該清理）",
        runner=_r_expired_active_positions,
    ),
    ReportSpec(
        id="recent_signups",
        label="近 7 天新註冊使用者",
        description="新註冊但尚未指派職位的使用者",
        runner=_r_recent_signups,
    ),
    ReportSpec(
        id="outbox_dead_letters",
        label="Outbox 失敗事件（dead）",
        description="重試達上限的通知，含最後錯誤訊息",
        runner=_r_outbox_dead_letters,
    ),
    ReportSpec(
        id="email_volume_daily",
        label="近 30 天 Email 寄送量（依日期 + 狀態）",
        description="排查 Email 異常量、failed 比例",
        runner=_r_email_volume_daily,
    ),
    ReportSpec(
        id="audit_event_volume_daily",
        label="近 30 天稽核事件量（依日期 + entity）",
        description="觀察某類事件是否異常暴增",
        runner=_r_audit_event_volume_daily,
    ),
    ReportSpec(
        id="inactive_users_no_positions",
        label="無職位但帳號仍啟用的使用者",
        description="可能該停用的「殘留」帳號（排除超管）",
        runner=_r_inactive_users_no_positions,
    ),
    ReportSpec(
        id="superuser_list",
        label="所有超級管理員",
        description="每月權限稽核必看",
        runner=_r_superuser_list,
    ),
    ReportSpec(
        id="orgs_position_summary",
        label="各組織職位與現任人數",
        description="檢查空轉組織、空缺職位",
        runner=_r_orgs_position_summary,
    ),
]

REPORTS_BY_ID: dict[str, ReportSpec] = {r.id: r for r in REPORTS}


def get_report(report_id: str) -> ReportSpec:
    spec = REPORTS_BY_ID.get(report_id)
    if spec is None:
        raise ValueError(f"未知的報表：{report_id}")
    return spec


async def run_report(session: AsyncSession, report_id: str) -> list[dict[str, Any]]:
    spec = get_report(report_id)
    try:
        return await spec.runner(session)
    except Exception:
        logger.exception("run_report failed report_id=%s", report_id)
        raise


def to_csv(rows: list[dict[str, Any]]) -> bytes:
    if not rows:
        return b"(empty)\n"
    buf = io.StringIO()
    fieldnames = list(rows[0].keys())
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for r in rows:
        writer.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fieldnames})
    return buf.getvalue().encode("utf-8-sig")  # BOM 讓 Excel 正確開啟中文
