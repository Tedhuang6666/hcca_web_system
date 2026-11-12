"""網站漏洞與功能問題回報的建立、查詢與處理。"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.site_report import SiteReport, SiteReportKind, SiteReportSeverity
from api.schemas.site_report import (
    SiteReportCreate,
    SiteReportOptionOut,
    SiteReportPortalOut,
    SiteReportUpdate,
)

KIND_OPTIONS: tuple[SiteReportOptionOut, ...] = (
    SiteReportOptionOut(
        value=SiteReportKind.VULNERABILITY.value,
        label="資安漏洞",
        description="可能造成資料外洩、權限繞過、注入攻擊或服務中斷的問題。",
    ),
    SiteReportOptionOut(
        value=SiteReportKind.BUG.value,
        label="功能錯誤",
        description="頁面顯示異常、操作失敗、資料錯誤等非資安問題。",
    ),
)

SEVERITY_OPTIONS: tuple[SiteReportOptionOut, ...] = (
    SiteReportOptionOut(
        value=SiteReportSeverity.LOW.value,
        label="低",
        description="不影響主要功能，或有替代操作方式。",
    ),
    SiteReportOptionOut(
        value=SiteReportSeverity.MEDIUM.value,
        label="中",
        description="部分功能無法使用，或需要特定條件才會發生。",
    ),
    SiteReportOptionOut(
        value=SiteReportSeverity.HIGH.value,
        label="高",
        description="核心功能受阻、敏感資料可能受影響。",
    ),
    SiteReportOptionOut(
        value=SiteReportSeverity.CRITICAL.value,
        label="緊急",
        description="可直接取得他人權限、大量資料外洩或服務全面中斷。",
    ),
)

PORTAL_NOTICE = (
    "請勿在回報內容中張貼密碼、驗證碼、完整信用卡號或其他不必要的個資。"
    "如果是資安漏洞，請先保留重現步驟，讓我們有機會在公開前完成修正。"
)


def get_portal() -> SiteReportPortalOut:
    return SiteReportPortalOut(
        is_open=True,
        notice=PORTAL_NOTICE,
        kinds=list(KIND_OPTIONS),
        severities=list(SEVERITY_OPTIONS),
    )


def _new_reference_code() -> str:
    return f"SR-{datetime.now(UTC):%Y%m%d}-{secrets.token_hex(3).upper()}"


async def create_report(
    db: AsyncSession,
    body: SiteReportCreate,
    reporter_id: uuid.UUID | None,
    *,
    user_agent: str | None = None,
) -> SiteReport:
    if body.website:
        raise ValueError("無法送出回報，請確認內容後再試一次")

    for _ in range(5):
        reference_code = _new_reference_code()
        exists = await db.scalar(
            select(SiteReport.id).where(SiteReport.reference_code == reference_code)
        )
        if exists is None:
            break
    else:
        raise ValueError("回報編號產生失敗，請稍後再試")

    report = SiteReport(
        reference_code=reference_code,
        kind=body.kind.value,
        severity=body.severity.value,
        title=body.title,
        description=body.description,
        steps_to_reproduce=body.steps_to_reproduce,
        affected_url=body.affected_url,
        contact_email=body.contact_email,
        reporter_id=reporter_id,
        user_agent=(user_agent or "")[:500] or None,
    )
    db.add(report)
    await db.flush()
    return report


async def list_reports(
    db: AsyncSession,
    *,
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[SiteReport]:
    stmt = select(SiteReport).order_by(SiteReport.created_at.desc())
    if status:
        stmt = stmt.where(SiteReport.status == status)
    if kind:
        stmt = stmt.where(SiteReport.kind == kind)
    stmt = stmt.limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def get_report(db: AsyncSession, report_id: uuid.UUID) -> SiteReport | None:
    return await db.get(SiteReport, report_id)


async def update_report(
    db: AsyncSession,
    report: SiteReport,
    body: SiteReportUpdate,
    reviewer_id: uuid.UUID,
) -> SiteReport:
    values = body.model_dump(exclude_unset=True)
    if "status" in values and body.status is not None:
        report.status = body.status.value
    if "severity" in values and body.severity is not None:
        report.severity = body.severity.value
    if "admin_note" in values:
        report.admin_note = body.admin_note
    report.reviewed_by = reviewer_id
    report.reviewed_at = datetime.now(UTC)
    await db.flush()
    return report


__all__ = [
    "KIND_OPTIONS",
    "PORTAL_NOTICE",
    "SEVERITY_OPTIONS",
    "create_report",
    "get_portal",
    "get_report",
    "list_reports",
    "update_report",
]
