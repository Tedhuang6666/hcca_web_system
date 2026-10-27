"""結案已確認修復的舊事故；預設只預覽，保留歷史與復發偵測。

在已部署且包含下列修復的 API 環境執行。--before 使用該版本部署時間；
先預覽，再以相同 --release、--before 與 --expected-count 加上 --apply 執行。
執行者須先確認 --release 與正在服務的映像版本相符；不清空資料表或錯誤緩衝。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from collections import Counter
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.core.database import AsyncSessionLocal
from api.models.observability import ObservabilityRelease
from api.models.system_incident import IncidentStatus, SystemIncident
from api.services.incident import append_incident_event

_RESOLVABLE_STATUSES = (IncidentStatus.OPEN, IncidentStatus.MITIGATED, IncidentStatus.REGRESSION)
_FIRST_PARTY_CSP = re.compile(
    r"^CSP blocked (?:connect-src: (?:https|wss)|(?:script-src-elem|worker-src): https)"
    r"://(?:www\.)?hcca\.tw(?:/|$)",
)


def known_fix(incident: SystemIncident) -> tuple[str, str] | None:
    """Match specific historical failures; generic network/CSP/DB failures stay open."""
    title, summary = incident.title, incident.summary or ""
    if incident.service == "web":
        if title.startswith("web: api.network at ") and summary in {
            "Failed to construct 'Response': Response with null body status cannot have body",
            "Response cannot have a body with the given status.",
        }:
            return "空回應狀態重建", "315034c3"
        if title.startswith("web: securitypolicyviolation at ") and _FIRST_PARTY_CSP.match(summary):
            return "舊版第一方 CSP 來源", "315034c3"
        if title.startswith("web: api.offline at "):
            return "離線觀測不建立事故", "315034c3"
        if title.startswith("web: api.withFallback at ") and summary == "登入已過期，請重新登入":
            return "登入過期預期回應", "315034c3"
    if incident.service == "hcca-api":
        if (
            title == "hcca-api: ResponseValidationError at /shop/products"
            and "max_quantity_per_user" in summary
            and "MissingGreenlet" in summary
        ):
            return "商品列表欄位載入", "315034c3"
        if (
            title == "hcca-api: ValueError at /email/preview"
            and summary.startswith("佔位符渲染失敗：")
            and ("unexpected '}'" in summary or "is undefined" in summary)
        ):
            return "信件預覽輸入驗證", "afcd49ad"
        if (
            title.startswith("hcca-api: IntegrityError at /shop/categories/")
            and "shop_delegation_links_category_id_fkey" in summary
        ):
            return "分類代訂授權外鍵檢查", "d52fb50b"
    return None


async def reconcile(
    session: AsyncSession,
    *,
    before: datetime,
    environment: str,
    release: str,
    apply: bool = False,
    expected_count: int | None = None,
) -> dict[str, object]:
    if before.tzinfo is None or before > datetime.now(UTC):
        raise ValueError("截止時間必須有時區且不可在未來")
    if not re.fullmatch(r"[0-9a-f]{40}", release):
        raise ValueError("必須指定已核對的完整版本 SHA")
    if settings.APP_RELEASE and release != settings.APP_RELEASE:
        raise ValueError("指定版本與目前 API 版本不符")
    if environment != settings.ENVIRONMENT:
        raise ValueError("指定環境與目前 API 環境不符")
    deployment = await session.scalar(
        select(ObservabilityRelease).where(
            ObservabilityRelease.commit_sha == release,
            ObservabilityRelease.environment == environment,
        )
    )
    if deployment is None:
        raise ValueError("找不到指定版本的部署紀錄")
    deployed_at = deployment.deployed_at
    if deployed_at.tzinfo is None:
        deployed_at = deployed_at.replace(tzinfo=UTC)
    if before > deployed_at:
        raise ValueError("截止時間不可晚於指定版本的部署時間")
    statement = select(SystemIncident).where(
        SystemIncident.environment == environment,
        SystemIncident.status.in_(_RESOLVABLE_STATUSES),
        SystemIncident.assigned_to.is_(None),
        SystemIncident.last_seen_at < before,
    )
    if apply:
        statement = statement.with_for_update()
    candidates = [
        (incident, fix)
        for incident in await session.scalars(statement)
        if (fix := known_fix(incident)) is not None
    ]
    if apply and (expected_count is None or len(candidates) != expected_count):
        raise ValueError("候選筆數與預覽不符；請重新預覽")
    now = datetime.now(UTC)
    groups = Counter(fix[0] for _, fix in candidates)
    if apply:
        for incident, (reason, fix_commit) in candidates:
            previous_status = incident.status
            previous_resolution_note = incident.resolution_note
            incident.status = IncidentStatus.RESOLVED
            incident.resolved_at = now
            incident.resolution_note = f"已確認舊版問題修復：{reason}（{fix_commit}）。"
            await append_incident_event(
                session,
                incident_id=incident.id,
                event_type="known_fix_resolved",
                actor_id=None,
                details={
                    "reason": reason,
                    "fix_commit": fix_commit,
                    "verified_release": release,
                    "last_seen_before": before.isoformat(),
                    "last_seen_at": incident.last_seen_at.isoformat(),
                    "occurrence_count": incident.occurrence_count,
                    "previous_status": previous_status,
                    "previous_resolution_note": previous_resolution_note,
                },
            )
    return {"applied": apply, "count": len(candidates), "groups": dict(groups)}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=datetime.fromisoformat, required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-count", type=int)
    args = parser.parse_args()
    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await reconcile(
                session,
                before=args.before,
                environment=args.environment,
                release=args.release,
                apply=args.apply,
                expected_count=args.expected_count,
            )
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
