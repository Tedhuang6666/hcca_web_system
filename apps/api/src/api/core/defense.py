"""Redis-backed defense policy projection used by middleware."""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import time
from typing import Any

from redis.exceptions import RedisError

from api.core.config import settings
from api.core.security import redis_client

DEFENSE_RULES_KEY = "defense:rules:v1"
RATE_LIMIT_CONFIG_KEY = "defense:rate_limit:v1"
DEFENSE_STATUS_KEY_PREFIX = "defense:status:"
_LOCAL_CACHE_TTL = 5.0

_rules_cache: tuple[float, list[dict[str, Any]]] | None = None
_rate_config_cache: tuple[float, dict[str, Any]] | None = None
_REDIS_TIMEOUT_SECONDS = 0.8

DEFAULT_RATE_LIMIT_OVERRIDES: list[dict[str, int | str]] = [
    {"path_prefix": "/internal/discord", "requests": 600, "window_seconds": 60},
    {"path_prefix": "/auth/refresh", "requests": 20, "window_seconds": 60},
    {"path_prefix": "/auth/google/login", "requests": 20, "window_seconds": 60},
    {"path_prefix": "/auth/google/callback", "requests": 20, "window_seconds": 60},
    {"path_prefix": "/admin/", "requests": 90, "window_seconds": 60},
    {"path_prefix": "/notifications/email", "requests": 10, "window_seconds": 60},
    {"path_prefix": "/email", "requests": 20, "window_seconds": 60},
    {"path_prefix": "/documents/attachments", "requests": 15, "window_seconds": 60},
    {"path_prefix": "/surveys", "requests": 40, "window_seconds": 60},
    {"path_prefix": "/petitions", "requests": 30, "window_seconds": 60},
]


def default_rate_limit_config() -> dict[str, Any]:
    return {
        "enabled": settings.RATE_LIMIT_ENABLED,
        "global_requests": settings.RATE_LIMIT_REQUESTS,
        "global_window_seconds": settings.RATE_LIMIT_WINDOW_SECONDS,
        "overrides": DEFAULT_RATE_LIMIT_OVERRIDES,
    }


def clear_cache() -> None:
    global _rules_cache, _rate_config_cache
    _rules_cache = None
    _rate_config_cache = None


async def publish_rules(rules: list[dict[str, Any]]) -> None:
    global _rate_config_cache, _rules_cache
    try:
        await asyncio.wait_for(
            redis_client.set(DEFENSE_RULES_KEY, json.dumps(rules, ensure_ascii=False), ex=86400),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except (RedisError, TimeoutError):
        return
    _rules_cache = (time.monotonic() + _LOCAL_CACHE_TTL, rules)
    _rate_config_cache = None


async def get_rules() -> list[dict[str, Any]]:
    global _rules_cache
    now = time.monotonic()
    if _rules_cache and _rules_cache[0] > now:
        return _rules_cache[1]
    try:
        raw = await asyncio.wait_for(
            redis_client.get(DEFENSE_RULES_KEY),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except (RedisError, TimeoutError):
        return []
    if not raw:
        rules: list[dict[str, Any]] = []
    else:
        try:
            parsed = json.loads(raw)
            rules = parsed if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError):
            rules = []
    _rules_cache = (now + _LOCAL_CACHE_TTL, rules)
    return rules


async def set_rate_limit_config(config: dict[str, Any]) -> dict[str, Any]:
    global _rate_config_cache
    with contextlib.suppress(RedisError, TimeoutError):
        await asyncio.wait_for(
            redis_client.set(RATE_LIMIT_CONFIG_KEY, json.dumps(config, ensure_ascii=False)),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    _rate_config_cache = (time.monotonic() + _LOCAL_CACHE_TTL, config)
    return config


async def get_rate_limit_config() -> dict[str, Any]:
    global _rate_config_cache
    now = time.monotonic()
    if _rate_config_cache and _rate_config_cache[0] > now:
        return _rate_config_cache[1]
    try:
        raw = await asyncio.wait_for(
            redis_client.get(RATE_LIMIT_CONFIG_KEY),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except (RedisError, TimeoutError):
        return default_rate_limit_config()
    if not raw:
        config = default_rate_limit_config()
    else:
        try:
            parsed = json.loads(raw)
            config = parsed if isinstance(parsed, dict) else default_rate_limit_config()
        except (json.JSONDecodeError, TypeError):
            config = default_rate_limit_config()
    rule_overrides: list[dict[str, int | str]] = []
    for rule in await get_rules():
        if rule.get("rule_type") != "rate_limit_override" or not _rule_not_expired(rule):
            continue
        rule_config = rule.get("config") if isinstance(rule.get("config"), dict) else {}
        try:
            requests = int(rule_config.get("requests"))
            window_seconds = int(rule_config.get("window_seconds"))
        except (TypeError, ValueError):
            continue
        if requests > 0 and window_seconds > 0:
            rule_overrides.append(
                {
                    "path_prefix": str(rule.get("target")),
                    "requests": requests,
                    "window_seconds": window_seconds,
                }
            )
    if rule_overrides:
        config = {**config, "overrides": [*rule_overrides, *config.get("overrides", [])]}
    _rate_config_cache = (now + _LOCAL_CACHE_TTL, config)
    return config


async def record_status(status_code: int) -> None:
    if status_code not in {403, 429, 503}:
        return
    now = int(time.time())
    bucket = now - (now % 60)
    key = f"{DEFENSE_STATUS_KEY_PREFIX}{status_code}:{bucket}"
    with contextlib.suppress(RedisError, TimeoutError):
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, 3600)
        await asyncio.wait_for(pipe.execute(), timeout=_REDIS_TIMEOUT_SECONDS)


async def recent_status_counts(window_seconds: int = 3600) -> dict[str, int]:
    now = int(time.time())
    buckets = [now - (now % 60) - offset for offset in range(0, window_seconds, 60)]
    keys = [
        f"{DEFENSE_STATUS_KEY_PREFIX}{status}:{bucket}"
        for status in (403, 429, 503)
        for bucket in buckets
    ]
    try:
        values = await asyncio.wait_for(redis_client.mget(keys), timeout=_REDIS_TIMEOUT_SECONDS)
    except (RedisError, TimeoutError):
        return {"403": 0, "429": 0, "503": 0}
    counts = {"403": 0, "429": 0, "503": 0}
    index = 0
    for status in ("403", "429", "503"):
        for _bucket in buckets:
            raw = values[index]
            index += 1
            if raw:
                with contextlib.suppress(ValueError, TypeError):
                    counts[status] += int(raw)
    return counts


def _rule_not_expired(rule: dict[str, Any]) -> bool:
    expires_at = rule.get("expires_at")
    return expires_at is None or float(expires_at) > time.time()


def _ip_matches(target: str, ip: str) -> bool:
    if target == ip:
        return True
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(target, strict=False)
    except ValueError:
        return False


async def is_ip_allowed(ip: str) -> bool:
    for rule in await get_rules():
        if rule.get("rule_type") != "ip_allow" or not _rule_not_expired(rule):
            continue
        if _ip_matches(str(rule.get("target", "")), ip):
            return True
    return False


async def is_ip_blocked(ip: str) -> bool:
    if await is_ip_allowed(ip):
        return False
    for rule in await get_rules():
        rule_type = rule.get("rule_type")
        if rule_type not in {"ip_block", "cidr_block"} or not _rule_not_expired(rule):
            continue
        if _ip_matches(str(rule.get("target", "")), ip):
            return True
    return False


async def find_ip_block(ip: str) -> dict[str, Any] | None:
    if await is_ip_allowed(ip):
        return None
    for rule in await get_rules():
        rule_type = rule.get("rule_type")
        if rule_type not in {"ip_block", "cidr_block"} or not _rule_not_expired(rule):
            continue
        if _ip_matches(str(rule.get("target", "")), ip):
            return rule
    return None


async def find_identity_block(
    *,
    user_id: str | None = None,
    emails: set[str] | None = None,
) -> dict[str, Any] | None:
    normalized_emails = {email.strip().lower() for email in emails or set() if email.strip()}
    for rule in await get_rules():
        if not _rule_not_expired(rule):
            continue
        rule_type = rule.get("rule_type")
        target = str(rule.get("target", "")).strip()
        if rule_type == "user_block" and user_id and target == user_id:
            return rule
        if rule_type == "email_block" and target.lower() in normalized_emails:
            return rule
    return None


async def endpoint_lockdown_reason(path: str) -> str | None:
    for rule in await get_rules():
        if rule.get("rule_type") != "endpoint_lockdown" or not _rule_not_expired(rule):
            continue
        target = str(rule.get("target", ""))
        if target and path.startswith(target):
            return str(rule.get("reason") or "endpoint_lockdown")
    return None
