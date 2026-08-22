from __future__ import annotations

import asyncio
import json
import logging
import math
import time
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from urllib.parse import urljoin

import httpx
from defusedxml import ElementTree
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_get, cache_set
from api.core.config import settings
from api.core.error_audit import get_recent_errors
from api.core.query_audit import get_slow_queries
from api.core.security import redis_client
from api.models.observability import (
    CruxSnapshot,
    ObservabilityRelease,
    PageSpeedAudit,
    PageSpeedRun,
)

PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
CRUX_URL = "https://chromeuxreport.googleapis.com/v1/records:queryRecord"
CRUX_HISTORY_URL = "https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord"
SITEMAP_PATH = "/sitemap.xml"
PAGE_SCORE_THRESHOLD = 95.0
PSI_AUDIT_IDS = (
    "largest-contentful-paint",
    "first-contentful-paint",
    "interaction-to-next-paint",
    "total-blocking-time",
    "cumulative-layout-shift",
    "server-response-time",
    "speed-index",
)
logger = logging.getLogger(__name__)
CLIENT_TELEMETRY_KEY = "observability:client-telemetry:v1"
CLIENT_TELEMETRY_MAX_ITEMS = 20_000
CLIENT_TELEMETRY_RETENTION_SECONDS = 172_800
CLIENT_TELEMETRY_ANALYTICS_CACHE_TTL_SECONDS = 10
CLIENT_TELEMETRY_WRITE_TIMEOUT_SECONDS = 0.25
# A full 24-hour buffer can contain up to 20k compact events; production Redis
# currently needs about 1.9s to transfer that bounded payload.
CLIENT_TELEMETRY_READ_TIMEOUT_SECONDS = 3.0
CLIENT_VITAL_METRICS = {"fcp", "lcp", "inp", "cls"}
DISCOVERED_URLS_CACHE_TTL_SECONDS = 300
PROVIDER_SNAPSHOT_CACHE_KEY = "observability:provider-snapshot:v1"
PROVIDER_SNAPSHOT_CACHE_TTL_SECONDS = 30
API_OPERATION_KINDS = {
    "simple_get": (300.0, 500.0),
    "crud": (500.0, 1_000.0),
    "heavy": (2_000.0, 4_000.0),
}
RUM_DIMENSION_DEFAULTS = {
    "device_class": "unknown",
    "auth_state": "unknown",
    "release": "unknown",
}


def _provider_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return exc.__class__.__name__


def _api_headers(key: str) -> dict[str, str]:
    # Keep provider credentials out of URLs so HTTP client and reverse-proxy logs cannot
    # accidentally persist the key.
    return {"x-goog-api-key": key}


def _normalize_client_path(path: object) -> str:
    value = str(path or "/").split("?", 1)[0].split("#", 1)[0].strip()
    if not value.startswith("/") or value.startswith("//"):
        return "/"
    return value[:255] or "/"


async def record_client_metrics(metrics: list[dict]) -> bool:
    """Store a bounded, short-lived first-party telemetry stream in Redis."""
    events = []
    now = time.time()
    for metric in metrics:
        name = str(metric.get("metric") or "")[:50]
        value = metric.get("value")
        if not name or not isinstance(value, (int, float)) or not math.isfinite(value):
            continue
        events.append(
            json.dumps(
                {
                    "metric": name,
                    "value": float(value),
                    "path": _normalize_client_path(metric.get("path")),
                    "status": metric.get("status"),
                    "interaction_id": str(metric.get("interaction_id") or "")[:80] or None,
                    "interaction_name": str(metric.get("interaction_name") or "")[:120] or None,
                    "interaction_kind": metric.get("interaction_kind"),
                    "operation_kind": metric.get("operation_kind"),
                    "method": str(metric.get("method") or "")[:12] or None,
                    "resource_name": str(metric.get("resource_name") or "")[:500] or None,
                    "initiator_type": str(metric.get("initiator_type") or "")[:50] or None,
                    "start_time_ms": metric.get("start_time_ms"),
                    "response_end_ms": metric.get("response_end_ms"),
                    "budget_ms": metric.get("budget_ms"),
                    "device_class": metric.get("device_class")
                    if metric.get("device_class") in {"mobile", "desktop"}
                    else RUM_DIMENSION_DEFAULTS["device_class"],
                    "auth_state": metric.get("auth_state")
                    if metric.get("auth_state") in {"public", "authenticated"}
                    else RUM_DIMENSION_DEFAULTS["auth_state"],
                    "connection_type": str(metric.get("connection_type") or "")[:20] or None,
                    "release": str(metric.get("release") or "")[:64]
                    or RUM_DIMENSION_DEFAULTS["release"],
                    "ts": now,
                },
                separators=(",", ":"),
            )
        )
    if not events:
        return True
    try:
        pipeline = redis_client.pipeline(transaction=False)
        # Use one variadic LPUSH for the whole batch.  The pipeline still keeps
        # retention updates atomic with the write, while avoiding one Redis
        # command per telemetry event on the request path.
        pipeline.lpush(CLIENT_TELEMETRY_KEY, *events)
        pipeline.ltrim(CLIENT_TELEMETRY_KEY, 0, CLIENT_TELEMETRY_MAX_ITEMS - 1)
        pipeline.expire(CLIENT_TELEMETRY_KEY, CLIENT_TELEMETRY_RETENTION_SECONDS)
        await asyncio.wait_for(
            pipeline.execute(),
            timeout=CLIENT_TELEMETRY_WRITE_TIMEOUT_SECONDS,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.debug("Client telemetry storage unavailable type=%s", _provider_error(exc))
        return False


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return round(ordered[index], 2)


def _budget_status(value: float | None, good: float, needs_improvement: float) -> str:
    if value is None:
        return "pending"
    if value <= good:
        return "good"
    if value <= needs_improvement:
        return "needs_improvement"
    return "poor"


def _percentiles(values: list[float], *, suffix: str = "") -> dict[str, float | None]:
    return {
        f"p50{suffix}": _percentile(values, 0.50),
        f"p75{suffix}": _percentile(values, 0.75),
        f"p95{suffix}": _percentile(values, 0.95),
        f"p99{suffix}": _percentile(values, 0.99),
    }


async def client_route_analytics(window_hours: int = 24) -> dict:
    """Aggregate route-level RUM without exposing individual visitors or URLs with queries."""
    cache_key = f"observability:rum:v1:{max(1, min(window_hours, 168))}h"
    try:
        cached = await asyncio.wait_for(cache_get(cache_key), timeout=0.25)
    except TimeoutError:
        cached = None
    if isinstance(cached, dict):
        return cached

    cutoff = time.time() - max(1, min(window_hours, 168)) * 3600
    try:
        raw_items = await asyncio.wait_for(
            redis_client.lrange(CLIENT_TELEMETRY_KEY, 0, CLIENT_TELEMETRY_MAX_ITEMS - 1),
            timeout=CLIENT_TELEMETRY_READ_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "available": False,
            "source": "first_party_redis",
            "error": _provider_error(exc),
            "window_hours": window_hours,
            "routes": [],
        }

    grouped: dict[str, dict] = {}
    for raw in raw_items:
        try:
            event = json.loads(raw)
            timestamp = float(event.get("ts", 0))
            if timestamp < cutoff:
                continue
            path = _normalize_client_path(event.get("path"))
            metric = str(event.get("metric") or "")
            device_class = str(event.get("device_class") or RUM_DIMENSION_DEFAULTS["device_class"])
            auth_state = str(event.get("auth_state") or RUM_DIMENSION_DEFAULTS["auth_state"])
            release = str(event.get("release") or RUM_DIMENSION_DEFAULTS["release"])
            group_key = "\x1f".join((path, device_class, auth_state, release))
            route = grouped.setdefault(
                group_key,
                {
                    "path": path,
                    "device_class": device_class,
                    "auth_state": auth_state,
                    "release": release,
                    "pageviews": 0,
                    "api_errors": 0,
                    "api_timeouts": 0,
                    "lcp": [],
                    "inp": [],
                    "cls": [],
                    "fcp": [],
                    "api_latency": [],
                    "api_latency_by_kind": {kind: [] for kind in API_OPERATION_KINDS},
                    "interaction_feedback": [],
                    "interaction_completion": [],
                    "client_errors": [],
                    "resource_timing": [],
                    "longtask": [],
                    "navigation_ttfb": [],
                    "navigation_total": [],
                    "custom_metrics": {},
                    "operations": {},
                },
            )
            if metric == "page_view":
                route["pageviews"] = int(route["pageviews"]) + 1
            elif metric in CLIENT_VITAL_METRICS:
                values = route[metric]
                assert isinstance(values, list)
                values.append(float(event["value"]))
            elif metric == "api_latency":
                values = route["api_latency"]
                assert isinstance(values, list)
                values.append(float(event["value"]))
                operation_kind = event.get("operation_kind")
                by_kind = route["api_latency_by_kind"]
                if operation_kind in API_OPERATION_KINDS and isinstance(by_kind, dict):
                    samples = by_kind[operation_kind]
                    assert isinstance(samples, list)
                    samples.append(float(event["value"]))
                status = int(event.get("status") or 0)
                if status >= 400:
                    route["api_errors"] = int(route["api_errors"]) + 1
                elif status == 0:
                    route["api_timeouts"] = int(route["api_timeouts"]) + 1
            elif metric in {"interaction_feedback", "interaction_completion"}:
                samples = route[metric]
                assert isinstance(samples, list)
                samples.append(float(event["value"]))
                name = event.get("interaction_name")
                operations = route["operations"]
                if isinstance(name, str) and name and isinstance(operations, dict):
                    operation = operations.setdefault(name, {"feedback": [], "completion": []})
                    operation_samples = operation[metric.removeprefix("interaction_")]
                    assert isinstance(operation_samples, list)
                    operation_samples.append(float(event["value"]))
            elif metric == "client_error":
                errors = route["client_errors"]
                assert isinstance(errors, list)
                errors.append(float(event["value"]))
            elif metric in {"resource_timing", "longtask", "navigation_ttfb", "navigation_total"}:
                samples = route[metric]
                assert isinstance(samples, list)
                samples.append(float(event["value"]))
            elif metric not in CLIENT_VITAL_METRICS and metric not in {
                "page_view",
                "api_latency",
                "api_circuit_open",
            }:
                custom_metrics = route["custom_metrics"]
                assert isinstance(custom_metrics, dict)
                samples = custom_metrics.setdefault(metric, [])
                assert isinstance(samples, list)
                samples.append(float(event["value"]))
        except (TypeError, ValueError, KeyError, json.JSONDecodeError):
            continue

    routes = []
    for values in grouped.values():
        operation_rows = []
        operations = values["operations"]
        if isinstance(operations, dict):
            for name, operation in operations.items():
                if not isinstance(operation, dict):
                    continue
                feedback = operation.get("feedback", [])
                completion = operation.get("completion", [])
                if not isinstance(feedback, list) or not isinstance(completion, list):
                    continue
                feedback_p75 = _percentile(feedback, 0.75)
                completion_p75 = _percentile(completion, 0.75)
                operation_rows.append(
                    {
                        "name": name,
                        "feedback_p75_ms": feedback_p75,
                        "completion_p75_ms": completion_p75,
                        "feedback_percentiles_ms": _percentiles(feedback, suffix="_ms"),
                        "completion_percentiles_ms": _percentiles(completion, suffix="_ms"),
                        "samples": len(feedback) + len(completion),
                        "feedback_status": _budget_status(feedback_p75, 100.0, 200.0),
                        "completion_status": _budget_status(completion_p75, 500.0, 2_000.0),
                    }
                )
        by_kind = values["api_latency_by_kind"]
        api_latency_by_kind = {
            kind: {
                **_percentiles(samples, suffix="_ms"),
                "p95_ms": _percentile(samples, 0.95),
                "budget_ms": budgets[0],
                "status": _budget_status(_percentile(samples, 0.95), *budgets),
            }
            for kind, budgets in API_OPERATION_KINDS.items()
            for samples in [by_kind.get(kind, []) if isinstance(by_kind, dict) else []]
        }
        routes.append(
            {
                "path": values["path"],
                "device_class": values["device_class"],
                "auth_state": values["auth_state"],
                "release": values["release"],
                "pageviews": int(values["pageviews"]),
                "api_errors": int(values["api_errors"]),
                "api_timeouts": int(values["api_timeouts"]),
                "samples": {metric: len(values[metric]) for metric in CLIENT_VITAL_METRICS},
                "web_vitals": {
                    key: value
                    for metric in CLIENT_VITAL_METRICS
                    for percentile_name, value in _percentiles(values[metric]).items()
                    for key in [f"{metric}_{percentile_name}"]
                },
                "api_latency_p95_ms": _percentile(values["api_latency"], 0.95),
                "api_latency_percentiles_ms": _percentiles(values["api_latency"], suffix="_ms"),
                "api_latency_p95_ms_by_kind": api_latency_by_kind,
                "interaction_feedback_p75_ms": _percentile(values["interaction_feedback"], 0.75),
                "interaction_feedback_percentiles_ms": _percentiles(
                    values["interaction_feedback"], suffix="_ms"
                ),
                "interaction_completion_p75_ms": _percentile(
                    values["interaction_completion"], 0.75
                ),
                "interaction_completion_percentiles_ms": _percentiles(
                    values["interaction_completion"], suffix="_ms"
                ),
                "interaction_samples": {
                    "feedback": len(values["interaction_feedback"]),
                    "completion": len(values["interaction_completion"]),
                },
                "client_errors": len(values["client_errors"]),
                "resource_timing_p75_ms": _percentile(values["resource_timing"], 0.75),
                "resource_timing_percentiles_ms": _percentiles(
                    values["resource_timing"], suffix="_ms"
                ),
                "longtask_p75_ms": _percentile(values["longtask"], 0.75),
                "longtask_percentiles_ms": _percentiles(values["longtask"], suffix="_ms"),
                "longtask_samples": len(values["longtask"]),
                "navigation_ttfb_p75_ms": _percentile(values["navigation_ttfb"], 0.75),
                "navigation_ttfb_percentiles_ms": _percentiles(
                    values["navigation_ttfb"], suffix="_ms"
                ),
                "navigation_total_p75_ms": _percentile(values["navigation_total"], 0.75),
                "navigation_total_percentiles_ms": _percentiles(
                    values["navigation_total"], suffix="_ms"
                ),
                "custom_metrics": {
                    name: {"p75_ms": _percentile(samples, 0.75), "samples": len(samples)}
                    for name, samples in values["custom_metrics"].items()
                    if isinstance(samples, list)
                },
                "interactions": sorted(
                    operation_rows, key=lambda item: item["samples"], reverse=True
                )[:20],
            }
        )
    routes.sort(key=lambda item: (item["pageviews"], sum(item["samples"].values())), reverse=True)
    total_pageviews = sum(route["pageviews"] for route in routes)
    result = {
        "available": True,
        "source": "first_party_redis",
        "window_hours": window_hours,
        "pageviews": total_pageviews,
        "routes": routes,
    }
    try:
        await asyncio.wait_for(
            cache_set(cache_key, result, ttl=CLIENT_TELEMETRY_ANALYTICS_CACHE_TTL_SECONDS),
            timeout=0.25,
        )
    except TimeoutError:
        logger.debug("client route analytics cache write timed out")
    return result


def _same_origin(url: str, base_url: str) -> bool:
    candidate = httpx.URL(url)
    base = httpx.URL(base_url)
    return candidate.scheme in {"http", "https"} and candidate.host == base.host


async def _read_sitemap(
    client: httpx.AsyncClient,
    sitemap_url: str,
    base_url: str,
    visited: set[str],
    depth: int = 0,
) -> list[str]:
    if depth > 3 or sitemap_url in visited or not _same_origin(sitemap_url, base_url):
        return []
    visited.add(sitemap_url)
    try:
        response = await client.get(sitemap_url)
        response.raise_for_status()
        root = ElementTree.fromstring(response.content)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sitemap collection failed type=%s", _provider_error(exc))
        return []

    locations = [
        value.text.strip()
        for value in root.iter()
        if value.tag.rsplit("}", 1)[-1] == "loc" and value.text and value.text.strip()
    ]
    root_kind = root.tag.rsplit("}", 1)[-1]
    if root_kind == "sitemapindex":
        nested = await asyncio.gather(
            *(
                _read_sitemap(client, location, base_url, visited, depth + 1)
                for location in locations
            )
        )
        return [item for group in nested for item in group]
    return [location for location in locations if _same_origin(location, base_url)]


async def discover_public_urls() -> list[str]:
    """Discover every same-origin URL exposed by the production sitemap."""
    cached = await cache_get("observability:discovered-urls")
    if isinstance(cached, list) and all(isinstance(url, str) for url in cached):
        return cached

    base = str(settings.FRONTEND_BASE_URL).rstrip("/") + "/"
    fallback = critical_urls()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
            sitemap_urls = await _read_sitemap(
                client, urljoin(base, SITEMAP_PATH.lstrip("/")), base, set()
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sitemap client failed type=%s", _provider_error(exc))
        sitemap_urls = []

    urls: list[str] = []
    for url in [*fallback, *sitemap_urls]:
        normalized = url.rstrip("/") or url
        if normalized not in urls and _same_origin(normalized, base):
            urls.append(normalized)
    await cache_set(
        "observability:discovered-urls",
        urls,
        ttl=DISCOVERED_URLS_CACHE_TTL_SECONDS,
    )
    return urls


def _has_rum_observation(route: dict) -> bool:
    """Treat any first-party metric as evidence that a route was actually used."""
    if (
        int(route.get("pageviews") or 0) > 0
        or int(route.get("api_errors") or 0) > 0
        or int(route.get("client_errors") or 0) > 0
    ):
        return True
    samples = route.get("samples") or {}
    return any(int(value or 0) > 0 for value in samples.values()) or bool(
        route.get("api_latency_p95_ms") is not None
    )


def _has_pageview_observation(route: dict) -> bool:
    """Only browser navigations are valid PSI targets; API metrics are not pages."""
    return int(route.get("pageviews") or 0) > 0


def _merge_rum_urls(urls: list[str], rum: dict) -> list[str]:
    """Include every same-origin route seen by first-party RUM in the scan set."""
    base = str(settings.FRONTEND_BASE_URL).rstrip("/") + "/"
    for route in rum.get("routes", []):
        if not _has_pageview_observation(route):
            continue
        path = _normalize_client_path(route.get("path"))
        url = urljoin(base, path.lstrip("/"))
        normalized = url.rstrip("/") or url
        if normalized not in urls and _same_origin(normalized, base):
            urls.append(normalized)
    return urls


async def discover_observability_urls() -> tuple[list[str], dict]:
    """Return sitemap/critical URLs plus routes actually visited by users."""
    rum = await client_route_analytics()
    return _merge_rum_urls(await discover_public_urls(), rum), rum


async def provider_snapshot() -> dict:
    try:
        cached = await asyncio.wait_for(cache_get(PROVIDER_SNAPSHOT_CACHE_KEY), timeout=0.25)
    except TimeoutError:
        cached = None
    if isinstance(cached, dict):
        return cached

    configured = bool(
        settings.SENTRY_AUTH_TOKEN and settings.SENTRY_ORG and settings.SENTRY_PROJECT
    )
    result: dict = {
        "sentry": {"configured": configured},
        "posthog": {"configured": bool(settings.POSTHOG_PERSONAL_API_KEY)},
    }
    if configured:
        timeout = httpx.Timeout(2.0, connect=0.5)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.get(
                    f"{settings.SENTRY_API_URL}/projects/{settings.SENTRY_ORG}/{settings.SENTRY_PROJECT}/stats/",
                    headers={"Authorization": f"Bearer {settings.SENTRY_AUTH_TOKEN}"},
                    params={"stat": "received", "interval": "1h"},
                )
                response.raise_for_status()
                result["sentry"]["stats"] = response.json()
            except httpx.HTTPError as exc:
                result["sentry"]["error"] = _provider_error(exc)
    with suppress(TimeoutError):
        await asyncio.wait_for(
            cache_set(
                PROVIDER_SNAPSHOT_CACHE_KEY,
                result,
                ttl=PROVIDER_SNAPSHOT_CACHE_TTL_SECONDS,
            ),
            timeout=0.25,
        )
    return result


async def crux_history(url: str, form_factor: str = "PHONE") -> dict:
    key = settings.GOOGLE_CRUX_API_KEY or settings.GOOGLE_PAGESPEED_API_KEY
    if not key:
        return {
            "url": url,
            "form_factor": form_factor,
            "collection_periods": [],
            "lcp_p75": [],
            "inp_p75": [],
            "cls_p75": [],
            "ttfb_p75": [],
        }
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            CRUX_HISTORY_URL,
            headers=_api_headers(key),
            json={"url": url, "formFactor": form_factor},
        )
        response.raise_for_status()
        record = response.json().get("record", {})
    metrics = record.get("metrics", {})

    def series(name: str) -> list[float | None]:
        return metrics.get(name, {}).get("percentilesTimeseries", {}).get("p75s", [])

    return {
        "url": url,
        "form_factor": form_factor,
        "collection_periods": record.get("collectionPeriods", []),
        "lcp_p75": series("largest_contentful_paint"),
        "inp_p75": series("interaction_to_next_paint"),
        "cls_p75": series("cumulative_layout_shift"),
        "ttfb_p75": series("experimental_time_to_first_byte"),
    }


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
    urls, rum = await discover_observability_urls()
    release = release or await ensure_release(session)
    results: list[tuple[str, str, dict | None, str | None]] = []
    # Lighthouse 會在一次 PSI 請求內衍生大量同源資源/API 請求；並行跑多個
    # URL 會把正式站的 upstream 健康檢查壓成 503。監控不得反過來影響使用者。
    semaphore = asyncio.Semaphore(1)

    async def fetch_one(client: httpx.AsyncClient, url: str, strategy: str) -> None:
        async with semaphore:
            try:
                response = await client.get(
                    PSI_URL,
                    headers=_api_headers(settings.GOOGLE_PAGESPEED_API_KEY),
                    params=[
                        ("url", url),
                        ("strategy", strategy),
                        ("category", "performance"),
                        ("category", "accessibility"),
                        ("category", "best-practices"),
                        ("category", "seo"),
                    ],
                )
                response.raise_for_status()
                results.append((url, strategy, response.json(), None))
            except Exception as exc:  # noqa: BLE001
                results.append((url, strategy, None, _provider_error(exc)))

    async with httpx.AsyncClient(timeout=60) as client:
        await asyncio.gather(
            *(
                fetch_one(client, url, strategy)
                for url in urls
                for strategy in ("mobile", "desktop")
            )
        )

    created = failed = 0
    for url, strategy, raw, error in results:
        lighthouse = (raw or {}).get("lighthouseResult", {})
        audits = lighthouse.get("audits", {})
        categories = lighthouse.get("categories", {})
        score = categories.get("performance", {}).get("score")
        has_result = bool(lighthouse and isinstance(score, (int, float)))
        run = PageSpeedRun(
            url=url,
            strategy=strategy,
            release_id=release.id,
            status="ok" if error is None and has_result else "error",
            error_message=error or (None if has_result else "missing_lighthouse_result"),
            performance_score=float(score) * 100 if has_result else None,
            lcp_ms=audits.get("largest-contentful-paint", {}).get("numericValue"),
            tbt_ms=audits.get("total-blocking-time", {}).get("numericValue"),
            cls=audits.get("cumulative-layout-shift", {}).get("numericValue"),
        )
        session.add(run)
        await session.flush()
        if run.status == "ok":
            for audit_id in PSI_AUDIT_IDS:
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
        else:
            failed += 1
    await session.flush()
    rum_urls = sum(1 for route in rum.get("routes", []) if _has_rum_observation(route))
    return {
        "created": created,
        "failed": failed,
        "urls": len(urls),
        "rum_urls": rum_urls,
        "strategies": 2,
    }


async def collect_crux_daily(session: AsyncSession) -> dict:
    key = settings.GOOGLE_CRUX_API_KEY or settings.GOOGLE_PAGESPEED_API_KEY
    if not key:
        return {"created": 0, "failed": 0, "skipped": "CrUX API key 未設定"}
    urls = await discover_public_urls()
    results: list[tuple[str, str, dict | None]] = []
    semaphore = asyncio.Semaphore(4)

    async def fetch_one(client: httpx.AsyncClient, url: str, form_factor: str) -> None:
        async with semaphore:
            try:
                response = await client.post(
                    CRUX_URL,
                    headers=_api_headers(key),
                    json={"url": url, "formFactor": form_factor},
                )
                response.raise_for_status()
                results.append((url, form_factor, response.json()))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "CrUX collection failed form_factor=%s type=%s",
                    form_factor,
                    _provider_error(exc),
                )
                results.append((url, form_factor, None))

    async with httpx.AsyncClient(timeout=60) as client:
        await asyncio.gather(
            *(
                fetch_one(client, url, form_factor)
                for url in urls
                for form_factor in ("PHONE", "DESKTOP")
            )
        )

    created = failed = 0
    for url, form_factor, data in results:
        if data is None:
            failed += 1
            continue
        metrics = data.get("record", {}).get("metrics", {})

        session.add(
            CruxSnapshot(
                url=url,
                form_factor=form_factor,
                lcp_p75=_crux_p75(metrics, "largest_contentful_paint"),
                inp_p75=_crux_p75(metrics, "interaction_to_next_paint"),
                cls_p75=_crux_p75(metrics, "cumulative_layout_shift"),
                ttfb_p75=_crux_p75(metrics, "experimental_time_to_first_byte"),
            )
        )
        created += 1
    await session.flush()
    return {"created": created, "failed": failed, "urls": len(urls), "form_factors": 2}


def _audit_metric(audits: list[PageSpeedAudit], *audit_ids: str) -> float | None:
    for audit in audits:
        if audit.audit_id in audit_ids:
            return audit.numeric_value
    return None


def _crux_p75(metrics: dict, name: str) -> float | None:
    return metrics.get(name, {}).get("percentiles", {}).get("p75")


async def latest_page_scores(
    session: AsyncSession,
    url: str | None = None,
    *,
    include_audits: bool = True,
) -> list[dict]:
    rows = (
        (
            await session.execute(
                select(PageSpeedRun).order_by(PageSpeedRun.tested_at.desc()).limit(2000)
            )
        )
        .scalars()
        .all()
    )
    latest: dict[tuple[str, str], PageSpeedRun] = {}
    for row in rows:
        if url and row.url != url:
            continue
        latest.setdefault((row.url, row.strategy), row)

    run_ids = [row.id for row in latest.values()]
    audit_rows = []
    if run_ids:
        audit_ids = (
            None if include_audits else ("interaction-to-next-paint", "server-response-time")
        )
        audit_query = select(PageSpeedAudit).where(PageSpeedAudit.run_id.in_(run_ids))
        if audit_ids is not None:
            audit_query = audit_query.where(PageSpeedAudit.audit_id.in_(audit_ids))
        audit_rows = (await session.execute(audit_query)).scalars().all()
    audits_by_run: dict[object, list[PageSpeedAudit]] = {}
    for audit in audit_rows:
        audits_by_run.setdefault(audit.run_id, []).append(audit)

    pages: dict[str, dict] = {}
    for (page_url, strategy), row in latest.items():
        audits = audits_by_run.get(row.id, [])
        strategy_data = {
            "score": row.performance_score,
            "status": row.status,
            "error": row.error_message,
            "tested_at": row.tested_at,
            "metrics": {
                "lcp_ms": row.lcp_ms,
                "inp_ms": _audit_metric(audits, "interaction-to-next-paint"),
                "tbt_ms": row.tbt_ms,
                "cls": row.cls,
                "ttfb_ms": _audit_metric(audits, "server-response-time"),
            },
            "audits": (
                [
                    {
                        "id": audit.audit_id,
                        "title": audit.title,
                        "score": audit.score,
                        "numeric_value": audit.numeric_value,
                        "display_value": audit.display_value,
                    }
                    for audit in sorted(
                        audits, key=lambda item: item.score if item.score is not None else -1
                    )
                ]
                if include_audits
                else []
            ),
        }
        page = pages.setdefault(
            page_url,
            {
                "url": page_url,
                "path": httpx.URL(page_url).path or "/",
                "source": "psi",
                "mobile": None,
                "desktop": None,
                "authenticated_mobile": None,
                "authenticated_desktop": None,
            },
        )
        if strategy in {"mobile", "desktop"}:
            page[strategy] = strategy_data
        elif strategy in {"auth-mobile", "auth-desktop"}:
            page[f"authenticated_{strategy.removeprefix('auth-')}"] = strategy_data
        elif strategy in {"public-mobile", "public-desktop"}:
            page[strategy.removeprefix("public-")] = strategy_data
            page["source"] = "synthetic"

    def _page_score_status(page: dict, mobile_key: str, desktop_key: str) -> str:
        modes = [page.get(mobile_key), page.get(desktop_key)]
        if any(mode is None for mode in modes):
            return "pending"
        if any(mode["status"] == "error" for mode in modes):
            return "error"
        if all(
            mode["status"] == "ok"
            and mode["score"] is not None
            and mode["score"] >= PAGE_SCORE_THRESHOLD
            for mode in modes
        ):
            return "pass"
        return "needs_attention"

    for page in pages.values():
        page["status"] = _page_score_status(page, "mobile", "desktop")
        page["authenticated_status"] = _page_score_status(
            page, "authenticated_mobile", "authenticated_desktop"
        )
    return sorted(pages.values(), key=lambda item: item["path"])


async def overview(session: AsyncSession) -> dict:
    cached = await cache_get("observability:overview")
    if isinstance(cached, dict):
        return cached

    day = datetime.now(UTC) - timedelta(days=1)
    pages = await latest_page_scores(session, include_audits=False)
    rum = await client_route_analytics()
    # The overview is requested by the admin UI and the agent snapshot. Do not
    # block either response on a cold sitemap fetch; PSI rows already contain
    # the monitored URL set, while RUM adds routes that were actually visited.
    try:
        discovered_catalog = await asyncio.wait_for(discover_public_urls(), timeout=1.5)
    except Exception:  # noqa: BLE001
        # The dashboard must remain responsive when the production sitemap is slow;
        # the next refresh retries while retaining the known configured/PSI routes.
        discovered_catalog = critical_urls()
    discovered_urls = _merge_rum_urls(
        list(dict.fromkeys([*discovered_catalog, *(page["url"] for page in pages)])), rum
    )
    rum_paths = {
        _normalize_client_path(route.get("path"))
        for route in rum.get("routes", [])
        if _has_rum_observation(route)
    }
    page_by_url = {page["url"]: page for page in pages}
    for page in page_by_url.values():
        if page["path"] in rum_paths:
            page["source"] = "rum"
    for url in discovered_urls:
        if url not in page_by_url:
            source = "rum" if httpx.URL(url).path in rum_paths else "configured"
            page_by_url[url] = {
                "url": url,
                "path": httpx.URL(url).path or "/",
                "source": source,
                "mobile": None,
                "desktop": None,
                "authenticated_mobile": None,
                "authenticated_desktop": None,
                "status": "pending",
                "authenticated_status": "pending",
            }
    pages = sorted(page_by_url.values(), key=lambda item: item["path"])

    mobile_scores = [
        page["mobile"]["score"]
        for page in pages
        if page.get("mobile") and page["mobile"]["score"] is not None
    ]
    desktop_scores = [
        page["desktop"]["score"]
        for page in pages
        if page.get("desktop") and page["desktop"]["score"] is not None
    ]
    mobile_lcp = [
        page["mobile"]["metrics"]["lcp_ms"]
        for page in pages
        if page.get("mobile") and page["mobile"]["metrics"]["lcp_ms"] is not None
    ]
    mobile_tbt = [
        page["mobile"]["metrics"]["tbt_ms"]
        for page in pages
        if page.get("mobile") and page["mobile"]["metrics"]["tbt_ms"] is not None
    ]
    run = (
        await session.execute(
            select(CruxSnapshot).order_by(CruxSnapshot.collected_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    recent_errors = await get_recent_errors(top=20)
    slow_queries = get_slow_queries(top=20)
    passing = sum(page["status"] == "pass" for page in pages)
    attention = sum(page["status"] == "needs_attention" for page in pages)
    errors = sum(page["status"] == "error" for page in pages)
    pending = sum(page["status"] == "pending" for page in pages)
    authenticated_pages = [
        page
        for page in pages
        if page.get("authenticated_mobile") is not None
        or page.get("authenticated_desktop") is not None
    ]
    authenticated_passing = sum(
        page.get("authenticated_status") == "pass" for page in authenticated_pages
    )
    authenticated_attention = sum(
        page.get("authenticated_status") == "needs_attention" for page in authenticated_pages
    )
    authenticated_errors = sum(
        page.get("authenticated_status") == "error" for page in authenticated_pages
    )
    release = (
        await session.execute(
            select(ObservabilityRelease).order_by(ObservabilityRelease.deployed_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    compact_pages = []
    for page in pages:
        compact_page = dict(page)
        for mode_key in (
            "mobile",
            "desktop",
            "authenticated_mobile",
            "authenticated_desktop",
        ):
            mode = page.get(mode_key)
            compact_page[mode_key] = {**mode, "audits": []} if mode else None
        compact_pages.append(compact_page)

    snapshot = {
        "coverage": {
            "discovered": len(discovered_urls),
            "monitored": len(pages),
            "passing": passing,
            "needs_attention": attention,
            "errors": errors,
            "pending": pending,
            "threshold": PAGE_SCORE_THRESHOLD,
        },
        "authenticated_coverage": {
            "monitored": len(authenticated_pages),
            "passing": authenticated_passing,
            "needs_attention": authenticated_attention,
            "errors": authenticated_errors,
            "pending": sum(page.get("authenticated_status") == "pending" for page in pages),
            "threshold": PAGE_SCORE_THRESHOLD,
        },
        "pages": compact_pages,
        "synthetic": {
            "mobile_performance": round(sum(mobile_scores) / len(mobile_scores), 2)
            if mobile_scores
            else None,
            "desktop_performance": round(sum(desktop_scores) / len(desktop_scores), 2)
            if desktop_scores
            else None,
            "mobile_lcp_ms": round(sum(mobile_lcp) / len(mobile_lcp), 2) if mobile_lcp else None,
            "mobile_tbt_ms": round(sum(mobile_tbt) / len(mobile_tbt), 2) if mobile_tbt else None,
            "tested_since": day,
        },
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
        "recent_errors": recent_errors,
        "slow_queries": slow_queries,
    }
    await cache_set("observability:overview", snapshot, ttl=15)
    return snapshot
