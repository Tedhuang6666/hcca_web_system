"""Sentry 錯誤追蹤 — 啟動時呼叫 init_sentry()。

僅在 SENTRY_DSN 有設定時啟用；未設定則完全 no-op。
PII / 敏感資料（token、password、cookie）會在 before_send 中過濾。
"""

from __future__ import annotations

import logging
from typing import Any

from sentry_sdk.types import Event

from api.core.config import settings

logger = logging.getLogger(__name__)


_SENSITIVE_KEYS = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "set-cookie",
        "csrf",
        "csrf_token",
        "x-csrf-token",
        "session",
        "api_key",
        "api-key",
    }
)


def _scrub(value: Any) -> Any:
    """遞迴掃描 dict/list/str，把疑似敏感欄位以 [Filtered] 取代。"""
    if isinstance(value, dict):
        return {
            k: ("[Filtered]" if str(k).lower() in _SENSITIVE_KEYS else _scrub(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _before_send(event: Event, _hint: dict[str, Any]) -> Event | None:
    """過濾 request headers / cookies / data 中的敏感欄位。"""
    from api.core.structured_logging import get_request_id

    request_id = get_request_id()
    if request_id:
        event.setdefault("tags", {})["request_id"] = request_id
        event.setdefault("extra", {})["request_id"] = request_id

    request = event.get("request")
    if isinstance(request, dict):
        if "headers" in request:
            request["headers"] = _scrub(request["headers"])
        if "cookies" in request:
            request["cookies"] = _scrub(request["cookies"])
        if "data" in request:
            request["data"] = _scrub(request["data"])
        if "query_string" in request:
            # 避免 ?token=xxx 在 URL 裡裸奔
            try:
                qs = str(request["query_string"])
                if any(key in qs.lower() for key in ("token=", "secret=", "password=")):
                    request["query_string"] = "[Filtered]"
            except Exception:
                logger.debug("Sentry query_string 過濾失敗", exc_info=True)
    extra = event.get("extra")
    if isinstance(extra, dict):
        event["extra"] = _scrub(extra)
    return event


def init_sentry() -> bool:
    """初始化 Sentry；回傳 True 表示有啟用。"""
    if not settings.SENTRY_DSN:
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.celery import CeleryIntegration
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk not installed; skipping init.")
        return False

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        release=settings.APP_VERSION,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        profiles_sample_rate=settings.SENTRY_PROFILES_SAMPLE_RATE,
        send_default_pii=False,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            CeleryIntegration(),
            SqlalchemyIntegration(),
        ],
        before_send=_before_send,
    )
    logger.info(
        "Sentry initialized env=%s traces=%.2f",
        settings.ENVIRONMENT,
        settings.SENTRY_TRACES_SAMPLE_RATE,
    )
    return True
