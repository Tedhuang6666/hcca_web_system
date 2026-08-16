# ruff: noqa: E701, E702, B023
from datetime import UTC, datetime, timedelta
from urllib.parse import urljoin

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.observability import (
    CruxSnapshot,
    ObservabilityRelease,
    PageSpeedAudit,
    PageSpeedRun,
)

PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
CRUX_URL = "https://chromeuxreport.googleapis.com/v1/records:queryRecord"
CRUX_HISTORY_URL = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord"


def critical_urls() -> list[str]:
    base = str(settings.FRONTEND_BASE_URL).rstrip("/") + "/"
    return [urljoin(base, path.lstrip("/")) for path in settings.OBSERVABILITY_CRITICAL_URLS]


async def ensure_release(
    session: AsyncSession, commit_sha: str | None = None
) -> ObservabilityRelease:
    sha = (
        commit_sha or settings.BUILD_COMMIT or settings.APP_RELEASE or settings.APP_VERSION
    ).strip()
    release = f"web@{sha}"
    row = (
        await session.execute(
            select(ObservabilityRelease).where(ObservabilityRelease.release == release)
        )
    ).scalar_one_or_none()
    if row:
        return row
    row = ObservabilityRelease(
        release=release,
        commit_sha=sha,
        environment=settings.ENVIRONMENT,
        deployed_at=datetime.now(UTC),
    )
    session.add(row)
    await session.flush()
    return row


async def collect_pagespeed(
    session: AsyncSession, release: ObservabilityRelease | None = None
) -> dict:
    if not settings.GOOGLE_PAGESPEED_API_KEY:
        return {"created": 0, "failed": 0, "skipped": "GOOGLE_PAGESPEED_API_KEY 未設定"}
    created = failed = 0
    async with httpx.AsyncClient(timeout=60) as client:
        for url in critical_urls():
            for strategy in ("mobile", "desktop"):
                try:
                    response = await client.get(
                        PSI_URL,
                        params=[
                            ("url", url),
                            ("strategy", strategy),
                            ("key", settings.GOOGLE_PAGESPEED_API_KEY),
                            ("category", "performance"),
                            ("category", "accessibility"),
                            ("category", "best-practices"),
                            ("category", "seo"),
                        ],
                    )
                    response.raise_for_status()
                    raw = response.json()
                    lighthouse = raw.get("lighthouseResult", {})
                    audits = lighthouse.get("audits", {})
                    categories = lighthouse.get("categories", {})
                    run = PageSpeedRun(
                        url=url,
                        strategy=strategy,
                        release_id=release.id if release else None,
                        performance_score=(categories.get("performance", {}).get("score") or 0)
                        * 100,
                        lcp_ms=audits.get("largest-contentful-paint", {}).get("numericValue"),
                        tbt_ms=audits.get("total-blocking-time", {}).get("numericValue"),
                        cls=audits.get("cumulative-layout-shift", {}).get("numericValue"),
                    )
                    session.add(run)
                    await session.flush()
                    for audit_id in (
                        "largest-contentful-paint",
                        "first-contentful-paint",
                        "total-blocking-time",
                        "cumulative-layout-shift",
                        "speed-index",
                    ):
                        audit = audits.get(audit_id)
                        if audit:
                            session.add(
                                PageSpeedAudit(
                                    run_id=run.id,
                                    audit_id=audit_id,
                                    title=audit.get("title", audit_id),
                                    score=audit.get("score"),
                                    numeric_value=audit.get("numericValue"),
                                    display_value=audit.get("displayValue"),
                                )
                            )
                    created += 1
                except Exception:  # noqa: BLE001
                    failed += 1
    await session.flush()
    return {"created": created, "failed": failed}


async def collect_crux_daily(session: AsyncSession) -> dict:
    key = settings.GOOGLE_CRUX_API_KEY or settings.GOOGLE_PAGESPEED_API_KEY
    if not key:
        return {"created": 0, "failed": 0, "skipped": "CrUX API key 未設定"}
    created = failed = 0
    async with httpx.AsyncClient(timeout=60) as client:
        for url in critical_urls():
            for form_factor in ("PHONE", "DESKTOP"):
                try:
                    response = await client.post(
                        CRUX_URL, params={"key": key}, json={"url": url, "formFactor": form_factor}
                    )
                    response.raise_for_status()
                    data = response.json()
                    metrics = data.get("record", {}).get("metrics", {})

                    def p75(name: str):
                        return metrics.get(name, {}).get("percentiles", {}).get("p75")

                    session.add(
                        CruxSnapshot(
                            url=url,
                            form_factor=form_factor,
                            lcp_p75=p75("largest_contentful_paint"),
                            inp_p75=p75("interaction_to_next_paint"),
                            cls_p75=p75("cumulative_layout_shift"),
                            ttfb_p75=p75("experimental_time_to_first_byte"),
                        )
                    )
                    created += 1
                except Exception:
                    failed += 1
    await session.flush()
    return {"created": created, "failed": failed}


async def overview(session: AsyncSession) -> dict:
    day = datetime.now(UTC) - timedelta(days=1)
    psi = (
        await session.execute(
            select(func.avg(PageSpeedRun.performance_score)).where(
                PageSpeedRun.strategy == "mobile",
                PageSpeedRun.tested_at >= day,
                PageSpeedRun.status == "ok",
            )
        )
    ).scalar()
    run = (
        await session.execute(
            select(CruxSnapshot).order_by(CruxSnapshot.collected_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    release = (
        await session.execute(
            select(ObservabilityRelease).order_by(ObservabilityRelease.deployed_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    return {
        "synthetic": {"mobile_performance": round(float(psi), 2) if psi is not None else None},
        "field": {
            "lcp_p75": run.lcp_p75 if run else None,
            "inp_p75": run.inp_p75 if run else None,
            "cls_p75": run.cls_p75 if run else None,
            "ttfb_p75": run.ttfb_p75 if run else None,
        },
        "latest_release": {
            "commit_sha": release.commit_sha if release else None,
            "deployed_at": release.deployed_at if release else None,
        },
    }
