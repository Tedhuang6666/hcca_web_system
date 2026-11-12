"""網站回報的通知收件人解析與訊息組成。"""

from __future__ import annotations

import logging
import uuid
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.permission_codes import PermissionCode
from api.models.org import Org, Permission, Position, UserPosition
from api.models.site_report import SiteReport, SiteReportKind, SiteReportSeverity
from api.models.user import User
from api.services.notification import notify_users

logger = logging.getLogger(__name__)

# 網站回報預設通知對象所屬組織；找不到成員時改通知具備處理權限的帳號。
NOTIFY_ORG_NAME = "資訊部"

KIND_LABELS: dict[str, str] = {
    SiteReportKind.VULNERABILITY.value: "資安漏洞",
    SiteReportKind.BUG.value: "功能錯誤",
}

SEVERITY_LABELS: dict[str, str] = {
    SiteReportSeverity.LOW.value: "低",
    SiteReportSeverity.MEDIUM.value: "中",
    SiteReportSeverity.HIGH.value: "高",
    SiteReportSeverity.CRITICAL.value: "緊急",
}

_NOTIFY_DESCRIPTION_LIMIT = 500


def _active_tenure_filters(today: date) -> tuple:
    return (
        UserPosition.start_date <= today,
        or_(UserPosition.end_date.is_(None), UserPosition.end_date >= today),
    )


async def _active_user_ids(
    db: AsyncSession, user_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    if not user_ids:
        return []
    rows = await db.scalars(
        select(User.id).where(User.id.in_(user_ids), User.is_active.is_(True))
    )
    valid = set(rows.all())
    return [user_id for user_id in dict.fromkeys(user_ids) if user_id in valid]


async def resolve_notify_user_ids(db: AsyncSession) -> list[uuid.UUID]:
    """回傳應收到新回報通知的帳號：資訊部在任幹部，必要時退回處理權限名單。"""
    today = date.today()
    org = await db.scalar(
        select(Org)
        .where(Org.name == NOTIFY_ORG_NAME, Org.is_active.is_(True))
        .limit(1)
    )
    user_ids: list[uuid.UUID] = []
    if org is not None:
        rows = await db.scalars(
            select(User.id)
            .join(UserPosition, UserPosition.user_id == User.id)
            .join(Position, Position.id == UserPosition.position_id)
            .where(
                Position.org_id == org.id,
                User.is_active.is_(True),
                *_active_tenure_filters(today),
            )
        )
        user_ids.extend(rows.all())
        if org.leader_user_id is not None:
            user_ids.append(org.leader_user_id)

    user_ids = await _active_user_ids(db, user_ids)
    if user_ids:
        return user_ids

    rows = await db.scalars(
        select(User.id)
        .join(UserPosition, UserPosition.user_id == User.id)
        .join(Position, Position.id == UserPosition.position_id)
        .join(Permission, Permission.position_id == Position.id)
        .where(
            Permission.code == PermissionCode.SITE_REPORT_MANAGE.value,
            User.is_active.is_(True),
            *_active_tenure_filters(today),
        )
    )
    return await _active_user_ids(db, list(rows.all()))


def _notification_body(report: SiteReport) -> str:
    lines = [
        f"回報編號：{report.reference_code}",
        "類型："
        f"{KIND_LABELS.get(report.kind, report.kind)}"
        f"／影響程度：{SEVERITY_LABELS.get(report.severity, report.severity)}",
        f"標題：{report.title}",
    ]
    if report.affected_url:
        lines.append(f"發生網址：{report.affected_url}")
    if report.contact_email:
        lines.append(f"聯絡 Email：{report.contact_email}")
    description = report.description or ""
    if len(description) > _NOTIFY_DESCRIPTION_LIMIT:
        description = f"{description[:_NOTIFY_DESCRIPTION_LIMIT]}…"
    if description:
        lines.extend(("", "問題描述：", description))
    return "\n".join(lines)


async def notify_new_report(
    db: AsyncSession,
    report: SiteReport,
    *,
    reporter_id: uuid.UUID | None = None,
) -> None:
    """通知資訊部幹部有新回報；任何失敗都不影響回報建立流程。"""
    try:
        recipient_ids = await resolve_notify_user_ids(db)
        if not recipient_ids:
            logger.warning("網站回報沒有可通知的收件人 report=%s", report.id)
            return
        await notify_users(
            db,
            user_ids=recipient_ids,
            exclude_user_ids=(reporter_id,) if reporter_id else (),
            type="site_report_received",
            title=f"新網站回報：{report.title}"[:200],
            body=_notification_body(report),
            link=f"/security-reports#report-{report.id}",
            related_id=report.id,
        )
    except Exception:
        logger.warning("網站回報通知失敗 report=%s", report.id, exc_info=True)


__all__ = [
    "KIND_LABELS",
    "NOTIFY_ORG_NAME",
    "SEVERITY_LABELS",
    "notify_new_report",
    "resolve_notify_user_ids",
]
