"""特徵式 WAF middleware — 在請求進到 router 前擋下常見注入 / 掃描特徵。

設計取捨：
  - 只掃 URL path、query string，以及少數高訊噪比 header（User-Agent / Referer）。
    *不* 讀 request body —— 避免破壞 streaming，也避開把大 body 撈進記憶體的成本。
    絕大多數掃描器 / 注入探測都打在 URL/query 上，這層已能攔下九成雜訊流量。
  - 規則分兩級信心：
      high   ：掃描器探測（/wp-admin、.env…）、路徑穿越、null byte、${jndi:}。
               這些在正常 SPA 流量中不可能出現 → WAF_ENABLED 時一律 400。
      medium ：SQLi / XSS 字串特徵，較可能誤判使用者輸入（如公告內文剛好含 <script
               的討論）。預設攔截，但可用 WAF_BLOCK_MEDIUM=false 降級成只記 log。
  - 純 ASGI middleware（不繼承 BaseHTTPMiddleware），熱路徑零 I/O；
    只有「命中高信心規則 → 累犯計數 / 自動封鎖」才碰 Redis，且 best-effort。
  - 命中高信心規則的 IP 在 WAF_AUTOBLOCK_WINDOW 內累積到 THRESHOLD 次，
    會被丟進既有 [ip_blocklist]，之後由 LoadShedMiddleware 在入口直接 403。
"""

from __future__ import annotations

import contextlib
import logging
import re
import threading
import time
from collections.abc import Awaitable, Callable
from urllib.parse import unquote, unquote_plus

from redis.exceptions import RedisError
from starlette.responses import JSONResponse
from starlette.types import Receive, Scope, Send

from api.core.config import settings
from api.core.ip_blocklist import block as ip_block
from api.core.security import redis_client
from api.core.trust import has_scan_bypass_token, is_trusted_ip

logger = logging.getLogger(__name__)

# SECURITY: Redis 故障時的 in-memory fallback 計數器。
# 每個 worker process 獨立計數（不跨 worker 共享），但已足夠防止同一 worker 被同一 IP 持續轟炸。
# TTL 以最後命中時間為基準；鎖保護 dict 操作避免 threading 競態。
_local_hit_counts: dict[str, int] = {}
_local_hit_times: dict[str, float] = {}
_local_hit_lock = threading.Lock()

# 不掃這些路徑：健檢 / 探活高頻打、靜態檔由其它層把關。
_EXEMPT_PATHS = frozenset({"/health", "/live", "/ready"})
_EXEMPT_PREFIXES = ("/uploads",)

Severity = str  # "high" | "medium"

# (name, severity, compiled_pattern, scope)
#   scope="path" → 只比對 URL path（掃描器探測這類，比對 query 反而易誤判）
#   scope="any"  → 比對 path + query + UA + Referer
_Rule = tuple[str, Severity, re.Pattern[str], str]


def _c(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


_RULES: tuple[_Rule, ...] = (
    # ---- 掃描器 / 自動化探測（path 上絕不該出現）----
    (
        "scanner_probe",
        "high",
        _c(
            r"(?:^|/)(?:wp-admin|wp-login|wp-content|xmlrpc\.php|phpmyadmin|"
            r"administrator/index|eval-stdin\.php|cgi-bin|boaform|hudson|"
            r"actuator/env|console/login)"
        ),
        "path",
    ),
    (
        "sensitive_file",
        "high",
        _c(
            r"(?:^|/)\.(?:env|git|aws|ssh|htpasswd|svn)(?:/|$)|"
            r"(?:^|/)(?:config\.php|wp-config\.php|id_rsa|credentials)(?:$|\?)"
        ),
        "path",
    ),
    (
        "script_extension",
        "high",
        _c(r"\.(?:php\d?|asp|aspx|jsp|cgi|bak|sql|env)(?:$|\?|/)"),
        "path",
    ),
    # ---- 路徑穿越 / LFI ----
    ("path_traversal", "high", _c(r"(?:\.\./|\.\.\\|%2e%2e[/\\%]|/etc/passwd|/proc/self/)"), "any"),
    # ---- Null byte / 控制字元注入 ----
    ("null_byte", "high", _c(r"(?:%00|\x00)"), "any"),
    # ---- Log4Shell / JNDI 注入 ----
    ("jndi_injection", "high", _c(r"\$\{(?:jndi|env|sys|lower|upper|date):"), "any"),
    # ---- SSTI 模板注入 ----
    (
        "template_injection",
        "medium",
        _c(r"\{\{.{0,40}(?:config|self|request|__class__).{0,40}\}\}"),
        "any",
    ),
    # ---- SQL 注入特徵 ----
    ("sqli_union", "medium", _c(r"\bunion\b[\s/*]+.{0,40}\bselect\b"), "any"),
    (
        "sqli_tautology",
        "medium",
        _c(r"(?:'|\")\s*(?:or|and)\s+(?:'?\d'?|\"?\w\"?)\s*=\s*(?:'?\d'?|\"?\w\"?)"),
        "any",
    ),
    (
        "sqli_keyword",
        "medium",
        _c(
            r"(?:;|'|\")\s*(?:drop|truncate|insert\s+into|delete\s+from|update\s+\w+\s+set)\b|"
            r"\binformation_schema\b|\bxp_cmdshell\b|\bpg_sleep\s*\(|\bsleep\s*\(\s*\d|\bbenchmark\s*\("
        ),
        "any",
    ),
    # ---- XSS 特徵 ----
    (
        "xss_tag",
        "medium",
        _c(r"<\s*(?:script|iframe|svg|img|object|embed|body)\b[^>]*(?:on\w+|src|>)"),
        "any",
    ),
    (
        "xss_handler",
        "medium",
        _c(r"(?:javascript:|vbscript:|data:text/html|on(?:error|load|click|mouseover|focus)\s*=)"),
        "any",
    ),
)


def _decoded_variants(value: str) -> list[str]:
    """原值 + 一/二次 URL 解碼，攔下 %2e%2e / 雙重編碼規避。"""
    out = [value]
    if "%" in value or "+" in value:
        with contextlib.suppress(Exception):
            once = unquote_plus(value)
            if once != value:
                out.append(once)
                if "%" in once:
                    twice = unquote(once)
                    if twice != once:
                        out.append(twice)
    return out


def scan_request(
    path: str, query: str, user_agent: str, referer: str
) -> tuple[str, Severity] | None:
    """純函式特徵掃描；命中回 (rule_name, severity)，否則 None。可單測。"""
    path_hay = _decoded_variants(path)
    any_hay = path_hay + _decoded_variants(query) + [user_agent, referer]
    for name, severity, pattern, rule_scope in _RULES:
        haystacks = path_hay if rule_scope == "path" else any_hay
        if any(pattern.search(h) for h in haystacks):
            return name, severity
    return None


def _header(scope: Scope, target: bytes) -> str:
    for k, v in scope.get("headers") or []:
        if k.lower() == target:
            try:
                return v.decode("latin-1")
            except UnicodeDecodeError:
                return ""
    return ""


def _client_ip(scope: Scope) -> str:
    client = scope.get("client")
    return client[0] if client else "unknown"


_JSON_BODY_SCAN_LIMIT = 64 * 1024  # 只讀前 64 KB，避免大 body 佔用記憶體
_HIGH_SEVERITY_RULES = tuple(r for r in _RULES if r[1] == "high")


def _scan_body_text(text: str) -> tuple[str, Severity] | None:
    """僅對高信心規則掃描 body 文字（低誤判率）。"""
    for name, severity, pattern, _ in _HIGH_SEVERITY_RULES:
        if pattern.search(text):
            return name, severity
    return None


class WAFMiddleware:
    """純 ASGI 特徵式 WAF。掛在 TrustedProxy 之後（看得到真實 IP）、LoadShed 之前。"""

    def __init__(self, app: Callable[[Scope, Receive, Send], Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not settings.WAF_ENABLED:
            await self.app(scope, receive, send)
            return

        # 帶有效掃描 token → 完全放行（供自家弱掃；rate limit / 黑名單同步繞過）
        if has_scan_bypass_token(scope):
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path in _EXEMPT_PATHS or any(path.startswith(p) for p in _EXEMPT_PREFIXES):
            await self.app(scope, receive, send)
            return

        raw_query = scope.get("query_string", b"")
        query = raw_query.decode("latin-1", "ignore") if raw_query else ""

        # 1. 超長 URL（規避 / 灌爆）
        if len(path) + len(query) > settings.WAF_MAX_URL_LENGTH:
            await self._reject(scope, send, "oversized_url", "high")
            return

        # 2. URL / header 特徵掃描
        hit = scan_request(
            path,
            query,
            _header(scope, b"user-agent"),
            _header(scope, b"referer"),
        )
        if hit is not None:
            name, severity = hit
            should_block = severity == "high" or (
                severity == "medium" and settings.WAF_BLOCK_MEDIUM
            )
            if settings.WAF_BLOCK_MODE and should_block:
                await self._reject(scope, send, name, severity)
                if severity == "high":
                    await self._record_offender(_client_ip(scope))
                return
            logger.warning(
                "WAF detect-only hit rule=%s severity=%s ip=%s method=%s path=%s",
                name,
                severity,
                _client_ip(scope),
                scope.get("method"),
                path,
            )
            await self.app(scope, receive, send)
            return

        # 3. JSON body 掃描（opt-in，僅高信心規則，限前 64 KB）
        if settings.WAF_SCAN_JSON_BODY and _header(scope, b"content-type").startswith(
            "application/json"
        ):
            body, receive = await self._buffer_body(receive)
            body_text = body.decode("utf-8", "replace")
            body_hit = _scan_body_text(body_text)
            if body_hit is not None:
                name, severity = body_hit
                if settings.WAF_BLOCK_MODE:
                    await self._reject(scope, send, f"body:{name}", severity)
                    await self._record_offender(_client_ip(scope))
                    return
                logger.warning(
                    "WAF body detect-only rule=%s ip=%s path=%s",
                    name,
                    _client_ip(scope),
                    path,
                )

        await self.app(scope, receive, send)

    async def _buffer_body(self, receive: Receive) -> tuple[bytes, Receive]:
        """讀取並緩衝 request body（最多 64 KB），回傳 body bytes 與可重播的 receive callable。"""
        chunks: list[bytes] = []
        total = 0
        more_body = True
        while more_body and total < _JSON_BODY_SCAN_LIMIT:
            message = await receive()
            chunk = message.get("body", b"")
            chunks.append(chunk)
            total += len(chunk)
            more_body = message.get("more_body", False)
        body = b"".join(chunks)[:_JSON_BODY_SCAN_LIMIT]

        # 重建可重播的 receive：先回放已讀內容，再繼續原始 stream
        replayed = False

        async def _replayed_receive() -> dict:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": more_body}
            return await receive()

        return body, _replayed_receive

    async def _reject(self, scope: Scope, send: Send, rule: str, severity: Severity) -> None:
        ip = _client_ip(scope)
        logger.warning(
            "WAF blocked rule=%s severity=%s ip=%s method=%s path=%s query=%s",
            rule,
            severity,
            ip,
            scope.get("method"),
            scope.get("path"),
            scope.get("query_string", b"")[:256],
        )
        resp = JSONResponse({"detail": "請求遭安全防護攔截"}, status_code=400)

        async def _noop_receive() -> dict:
            return {"type": "http.disconnect"}

        await resp(scope, receive=_noop_receive, send=send)

    async def _record_offender(self, ip: str) -> None:
        """命中高信心規則 → 累犯計數；超閾值自動封鎖 IP。Best-effort，不阻塞。"""
        if not settings.WAF_AUTOBLOCK_ENABLED or ip in ("", "unknown"):
            return
        # 自己人白名單 IP 不計入累犯、不自動封鎖（單次特徵仍會 400，但不會被鎖在門外）
        if is_trusted_ip(ip):
            return
        key = f"waf:offender:{ip}"
        try:
            pipe = redis_client.pipeline()
            pipe.incr(key)
            pipe.expire(key, settings.WAF_AUTOBLOCK_WINDOW_SECONDS)
            count, _ = await pipe.execute()
            count = int(count)
        except (RedisError, TimeoutError):
            # SECURITY: Redis 故障時 fallback 到 in-memory 計數，
            # 避免 autoblock 在 Redis 不可用時完全失效（fail-open 攻擊面）。
            count = self._local_incr(ip)
            logger.warning(
                "WAF offender counter using local fallback for ip=%s count=%s", ip, count
            )
        if count >= settings.WAF_AUTOBLOCK_THRESHOLD:
            with contextlib.suppress(Exception):
                await ip_block(
                    ip,
                    reason=f"waf_autoblock hits={count}/{settings.WAF_AUTOBLOCK_WINDOW_SECONDS}s",
                    ttl_seconds=settings.WAF_AUTOBLOCK_TTL_SECONDS,
                )
                logger.warning("WAF auto-blocked IP=%s after %s hits", ip, count)

    @staticmethod
    def _local_incr(ip: str) -> int:
        """Thread-safe in-memory 命中計數，附 TTL 清理（基於 WAF_AUTOBLOCK_WINDOW_SECONDS）。"""
        now = time.monotonic()
        window = settings.WAF_AUTOBLOCK_WINDOW_SECONDS
        with _local_hit_lock:
            # 若上次命中已超過 window，重置計數
            last = _local_hit_times.get(ip, 0.0)
            if now - last > window:
                _local_hit_counts[ip] = 0
            _local_hit_counts[ip] = _local_hit_counts.get(ip, 0) + 1
            _local_hit_times[ip] = now
            return _local_hit_counts[ip]
