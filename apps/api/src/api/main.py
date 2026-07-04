"""校園自治整合平台 API - FastAPI Application"""

import asyncio
import logging
import time
import uuid
from asyncio import timeout
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import Response

from api.core.audit import SecurityAuditMiddleware
from api.core.config import settings
from api.core.csrf import CSRFMiddleware
from api.core.database import engine
from api.core.defense import record_status as record_defense_status
from api.core.error_audit import record_error
from api.core.idempotency import IdempotencyMiddleware
from api.core.load_shed import LoadShedMiddleware
from api.core.load_signals import dec_active, inc_active, record_status
from api.core.module_health import maybe_trip_module, record_module_status
from api.core.modules import match_module
from api.core.payload_limit import PayloadLimitMiddleware
from api.core.posthog import init_posthog, shutdown_posthog
from api.core.query_audit import (
    N_PLUS_ONE_THRESHOLD,
    get_request_counters,
    reset_request_counters,
)
from api.core.query_audit import (
    install_listeners as install_query_audit,
)
from api.core.rate_limit import SimpleRateLimitMiddleware
from api.core.request_id import RequestIDMiddleware
from api.core.security_headers import SecurityHeadersMiddleware
from api.core.sentry import init_sentry
from api.core.structured_logging import configure_logging
from api.core.trusted_proxy import TrustedProxyMiddleware
from api.core.waf import WAFMiddleware
from api.dependencies.impersonation_guard import ImpersonationReadOnlyMiddleware
from api.routers import (
    activities,
    admin,
    admin_system,
    analytics,
    announcements,
    api_keys,
    audit,
    auth,
    calendar,
    council_proposals,
    dashboard,
    data_lifecycle,
    discord,
    discord_internal,
    documents,
    documents_approve,
    documents_attachments,
    elections,
    email,
    email_platform,
    exam_papers,
    feature_flags,
    governance,
    impersonation,
    inventory,
    judicial_petitions,
    line_webhook,
    loans,
    meal,
    meetings,
    metrics_endpoint,
    mfa,
    navigation_profiles,
    notifications,
    orgs,
    partner_map,
    people,
    petitions,
    policies,
    positions,
    privacy,
    public_api,
    publications,
    receivables,
    regulations,
    reports,
    saved_filters,
    school_class,
    search,
    seating,
    shop,
    site,
    survey,
    tasks,
    term_rollover,
    trash,
    user_lifecycle,
    user_positions,
    users,
    webhooks,
    work_items,
    workflows,
    ws,
)
from api.routers._module_health import attach_module_health
from api.routers.documents_serial import serial_router, template_router

logger = logging.getLogger(__name__)

# 高頻健檢 / 輪詢端點：access log 對它們意義不大，每秒洗版反而蓋掉真正有用的訊息。
# 想要看就把 ACCESS_LOG_QUIET_POLLING=false。
_QUIET_POLLING_PATHS: frozenset[str] = frozenset(
    {
        "/health",
        "/live",
        "/ready",
        "/system/maintenance",
        "/system/module-status",
        "/notifications/inbox/count",
    }
)


def _is_quiet_polling(path: str) -> bool:
    if path in _QUIET_POLLING_PATHS:
        return True
    # 模組健康探測（每個 module router 都掛了一個）
    return path.endswith("/__module_health__")


async def _check_database() -> tuple[bool, str | None]:
    try:
        async with timeout(settings.HEALTHCHECK_TIMEOUT_SECONDS):
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
    except Exception as exc:
        logger.warning("Database readiness check failed", exc_info=True)
        return False, exc.__class__.__name__
    return True, None


async def _check_redis() -> tuple[bool, str | None]:
    from api.core.security import redis_client

    try:
        async with timeout(settings.HEALTHCHECK_TIMEOUT_SECONDS):
            await redis_client.ping()
    except (RedisError, TimeoutError) as exc:
        logger.warning("Redis readiness check failed", exc_info=True)
        return False, exc.__class__.__name__
    except Exception as exc:
        logger.warning("Unexpected Redis readiness check failure", exc_info=True)
        return False, exc.__class__.__name__
    return True, None


async def _await_readiness(
    check: Callable[[], Awaitable[tuple[bool, str | None]]],
    label: str,
) -> None:
    """啟動時等待依賴服務就緒：退避重試直到 STARTUP_READINESS_MAX_WAIT_SECONDS 才放棄。

    避免資源緊張時 DB / Redis 短暫變慢，就讓 app 立刻 raise → 容器 crash-loop flapping。
    退避間隔 1→2→4→8s（上限 8s）。
    """
    max_wait = settings.STARTUP_READINESS_MAX_WAIT_SECONDS
    deadline = time.monotonic() + max_wait
    delay = 1.0
    attempt = 0
    last_err: str | None = None
    while True:
        attempt += 1
        ok, err = await check()
        if ok:
            if attempt > 1:
                logger.info("%s readiness OK after %d attempt(s)", label, attempt)
            return
        last_err = err
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"{label} readiness check failed at startup after "
                f"{attempt} attempt(s)/{max_wait}s: {last_err}"
            )
        logger.warning(
            "%s not ready (attempt %d, err=%s); retrying in %.0fs",
            label,
            attempt,
            last_err,
            delay,
        )
        await asyncio.sleep(delay)
        delay = min(delay * 2, 8.0)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """應用程式啟動/關閉生命週期管理 — staged startup。

    DB、Redis 與 WS broker 必須先就緒；任一失敗即停止啟動。
    模組自檢會併發執行，失敗模組進入 5 分鐘自動維護，其他模組照常啟動。
    """
    from api.core.database import AsyncSessionLocal
    from api.core.module_registry import apply_startup_results, run_startup_checks
    from api.core.ws_manager import setup_broker, shutdown_broker
    from api.services.defense import sync_active_rules

    # 核心服務使用退避重試，給依賴服務暖機時間。
    await _await_readiness(_check_database, "DB")
    await _await_readiness(_check_redis, "Redis")

    await setup_broker()
    async with AsyncSessionLocal() as session:
        await sync_active_rules(session)

    # 模組自檢不阻塞啟動，且各自使用獨立 session。
    try:
        results = await run_startup_checks()
        failed = {mid: err for mid, err in results.items() if err}
        if failed:
            logger.warning("Module startup checks failed: %s", failed)
            await apply_startup_results(results)
        else:
            logger.info("Module startup checks passed (%d modules)", len(results) or 0)
    except Exception:
        logger.exception("Module startup phase raised; app will still serve")

    try:
        yield
    finally:
        await shutdown_broker()
        shutdown_posthog()
        from api.core.security import redis_client

        await redis_client.aclose()


def create_app() -> FastAPI:
    """應用程式工廠函式"""
    configure_logging()
    # 在 FastAPI app 建立之前 init Sentry，這樣 ASGI / fastapi integration 才能 patch
    init_sentry()
    init_posthog()
    install_query_audit()
    # prometheus_client 未安裝時，metrics collectors 不執行任何操作。
    from api.core.prometheus_metrics import (
        PrometheusMetricsMiddleware,
        init_metrics,
    )

    init_metrics()

    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="校園自治整合平台 RESTful API",
        docs_url="/docs" if (settings.DEBUG or settings.ENABLE_API_DOCS) else None,
        redoc_url="/redoc" if (settings.DEBUG or settings.ENABLE_API_DOCS) else None,
        lifespan=lifespan,
    )

    # Middleware 注意：Starlette 是 LIFO 包裝，最後 add 的最外層先執行。
    # 所以「越早」需要的（信任代理 / payload 上限）應該「最後」add，
    # 「越晚」需要的（CORS / Session）應該「最早」add。
    # GZip 壓縮回應：最早 add（最內層），在 response path 最先執行，
    # 把 app 輸出的 JSON 壓縮後再向外傳給其他 middleware。minimum_size=500 避免壓縮小回應。
    app.add_middleware(GZipMiddleware, minimum_size=500)
    app.add_middleware(
        SecurityHeadersMiddleware,
        enabled=settings.SECURITY_HEADERS_ENABLED,
        hsts_enabled=settings.COOKIE_SECURE,
        hsts_max_age=settings.SECURITY_HSTS_MAX_AGE_SECONDS,
        content_security_policy=settings.SECURITY_CSP,
    )
    # Prometheus metrics middleware（最外層、每筆 request 都會看到）
    app.add_middleware(PrometheusMetricsMiddleware)
    app.add_middleware(SecurityAuditMiddleware)
    app.add_middleware(
        SimpleRateLimitMiddleware,
        enabled=settings.RATE_LIMIT_ENABLED,
        requests=settings.RATE_LIMIT_REQUESTS,
        window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
    )
    app.add_middleware(IdempotencyMiddleware)
    # impersonation 唯讀守衛：帶 impersonation token 的寫入請求一律 403。
    # 純 JWT 解碼判斷、只增不減授權，故掛在此處安全。
    app.add_middleware(ImpersonationReadOnlyMiddleware)
    app.add_middleware(CSRFMiddleware, enabled=True, secure=settings.COOKIE_SECURE)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
    )
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.SECRET_KEY,
        session_cookie=settings.SESSION_COOKIE_NAME,
        same_site=settings.COOKIE_SAMESITE,
        https_only=settings.COOKIE_SECURE,
    )
    # Payload 大小上限：在 host / proxy 檢查通過後第一個粗篩
    app.add_middleware(
        PayloadLimitMiddleware,
        max_bytes_json=settings.PAYLOAD_MAX_BYTES_JSON,
        max_bytes_multipart=settings.PAYLOAD_MAX_BYTES_MULTIPART,
    )
    # Load shed（admin 優先 + IP 黑名單 + maintenance mode）：在 host 檢查之後、
    # rate_limit / CSRF 之前。如此被擋下的請求不會浪費 CSRF 驗證資源。
    app.add_middleware(LoadShedMiddleware)
    # WAF：特徵式注入/掃描偵測。執行序在 RequestID / TrustedProxy 之後
    # （看得到真實使用者 IP，才能正確記 log 與自動封鎖累犯），
    # 並在 rate_limit / CSRF / router 之前就把明顯惡意請求擋掉。
    app.add_middleware(WAFMiddleware)
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.ALLOWED_HOSTS)
    # 信任代理必須在最外層，這樣後續 middleware（rate limit / audit / CSRF）
    # 看到的 request.client.host 就已經是真實使用者 IP，而非 Cloudflare edge。
    app.add_middleware(
        TrustedProxyMiddleware,
        enabled=settings.TRUST_CLOUDFLARE_PROXY,
        extra_cidrs=settings.CF_TRUSTED_PROXIES,
    )

    # 模組健康端點：在 include_router 之前掛上，這樣每個模組會自帶
    # GET /{prefix}/__module_health__ 給斷路器的 half-open 探測使用。
    attach_module_health(documents.router, module_id="documents")
    attach_module_health(regulations.router, module_id="regulations")
    attach_module_health(meetings.router, module_id="meetings")
    attach_module_health(calendar.router, module_id="calendar")
    attach_module_health(council_proposals.router, module_id="councilProposals")
    attach_module_health(judicial_petitions.router, module_id="judicialPetitions")
    attach_module_health(announcements.router, module_id="announcements")
    attach_module_health(shop.router, module_id="shop")
    attach_module_health(meal.router, module_id="meal")
    attach_module_health(survey.router, module_id="surveys")
    attach_module_health(petitions.router, module_id="petitions")
    attach_module_health(exam_papers.router, module_id="examPapers")
    attach_module_health(partner_map.router, module_id="partnerMap")
    attach_module_health(line_webhook.router, module_id="line")
    attach_module_health(discord.router, module_id="discord")
    attach_module_health(governance.router, module_id="governance")
    attach_module_health(activities.router, module_id="activities")
    attach_module_health(elections.router, module_id="elections")
    attach_module_health(seating.router, module_id="seating")

    # lifespan 會併發執行模組自檢；
    # 預設 check 只 ping DB，足以偵測「資料庫斷線」「該模組表不存在」這類致命狀態。
    from api.core.module_registry import register as _register_module
    from api.routers._module_health import _default_check as _module_default_check

    for _mid in (
        "documents",
        "regulations",
        "meetings",
        "calendar",
        "councilProposals",
        "judicialPetitions",
        "announcements",
        "shop",
        "meal",
        "surveys",
        "petitions",
        "examPapers",
        "partnerMap",
        "line",
        "discord",
        "governance",
        "activities",
        "elections",
        "seating",
    ):
        _register_module(_mid, startup_check=_module_default_check)

    app.include_router(auth.router)
    app.include_router(mfa.router)
    app.include_router(users.router)
    app.include_router(audit.router)
    app.include_router(announcements.router)
    app.include_router(admin.router)
    app.include_router(admin_system.public_router)
    app.include_router(admin_system.router)
    app.include_router(navigation_profiles.router)
    app.include_router(data_lifecycle.router)
    app.include_router(trash.router)
    app.include_router(privacy.router)
    app.include_router(term_rollover.router)
    app.include_router(user_lifecycle.router)
    app.include_router(reports.router)
    app.include_router(activities.router)
    app.include_router(receivables.router)
    app.include_router(publications.router)
    app.include_router(orgs.router)
    app.include_router(people.router)
    app.include_router(partner_map.router)
    app.include_router(council_proposals.router)
    app.include_router(judicial_petitions.router)
    app.include_router(petitions.router)
    app.include_router(positions.router)
    app.include_router(user_positions.router)
    app.include_router(documents.router)
    app.include_router(documents_approve.router)
    app.include_router(documents_attachments.router)
    app.include_router(discord.router)
    app.include_router(discord_internal.router)
    app.include_router(template_router)
    app.include_router(serial_router)
    app.include_router(regulations.router)
    app.include_router(saved_filters.router)
    app.include_router(search.router)
    app.include_router(site.router)
    app.include_router(shop.router)
    app.include_router(seating.router)
    app.include_router(school_class.router)
    app.include_router(meal.router)
    app.include_router(meetings.router)
    app.include_router(meetings.public_router)
    app.include_router(calendar.router)
    app.include_router(survey.router)
    app.include_router(notifications.router)
    app.include_router(email.router)
    app.include_router(email_platform.router)
    app.include_router(elections.router)
    app.include_router(exam_papers.router)
    app.include_router(analytics.router)
    app.include_router(dashboard.router)
    app.include_router(tasks.router)
    app.include_router(loans.router)
    app.include_router(inventory.router)
    app.include_router(work_items.router)
    app.include_router(governance.router)
    app.include_router(line_webhook.router)
    app.include_router(ws.router)
    app.include_router(policies.router)
    app.include_router(api_keys.router)
    app.include_router(webhooks.router)
    app.include_router(workflows.router)
    app.include_router(public_api.router)
    app.include_router(metrics_endpoint.router)
    app.include_router(impersonation.router)
    app.include_router(feature_flags.router)

    # 使用者上傳檔案的靜態存取：僅限「本就公開」的媒體前綴（公告圖、問卷圖、官網素材）。
    # 公文附件（uploads/{document_id}/...）刻意不在此靜態服務，必須走已授權的
    # /documents/{doc_id}/attachments/{att_id}/download|preview 端點，否則會繞過
    # assert_access / 密等檢查造成未認證下載。詳見 api.core.uploads_static。
    from api.core.uploads_static import PublicUploadsStaticFiles

    app.mount(
        "/uploads",
        PublicUploadsStaticFiles(directory="uploads", check_dir=False),
        name="uploads",
    )

    @app.middleware("http")
    async def _request_timing_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        start = time.perf_counter()
        inc_active()
        reset_request_counters()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            duration_ms = (time.perf_counter() - start) * 1000
            response.headers["X-Process-Time-Ms"] = f"{duration_ms:.1f}"
            query_count, slow_count, query_ms = get_request_counters()
            response.headers["X-DB-Queries"] = str(query_count)
            response.headers["X-DB-Time-Ms"] = f"{query_ms:.1f}"
            if duration_ms > settings.SLOW_REQUEST_THRESHOLD_MS:
                logger.warning(
                    "Slow request path=%s method=%s status=%s duration_ms=%.1f "
                    "queries=%d slow_queries=%d query_ms=%.1f",
                    request.url.path,
                    request.method,
                    response.status_code,
                    duration_ms,
                    query_count,
                    slow_count,
                    query_ms,
                )
            elif query_count >= N_PLUS_ONE_THRESHOLD:
                logger.warning(
                    "Potential N+1 detected path=%s method=%s queries=%d query_ms=%.1f",
                    request.url.path,
                    request.method,
                    query_count,
                    query_ms,
                )
            if settings.ACCESS_LOG_ENABLED and not _is_quiet_polling(request.url.path):
                # 訊息本身做成自我可讀（text/json 模式都有用）。
                # 5xx 與 4xx 升 level 方便肉眼掃描；2xx/3xx 維持 INFO。
                if response.status_code >= 500:
                    log_fn = logger.error
                elif response.status_code >= 400:
                    log_fn = logger.warning
                else:
                    log_fn = logger.info
                log_fn(
                    "%s %s -> %d in %.1fms (q=%d db=%.1fms)",
                    request.method,
                    request.url.path,
                    response.status_code,
                    duration_ms,
                    query_count,
                    query_ms,
                    extra={
                        "event": "http.request",
                        "method": request.method,
                        "path": request.url.path,
                        "status_code": response.status_code,
                        "duration_ms": round(duration_ms, 1),
                        "db_queries": query_count,
                        "db_time_ms": round(query_ms, 1),
                        "client_ip": request.client.host if request.client else None,
                        "user_agent": request.headers.get("user-agent"),
                    },
                )
            return response
        finally:
            dec_active()
            record_status(status_code)
            await record_defense_status(status_code)
            try:
                # 健康探測端點不計入模組健康樣本（避免自我反饋迴圈）
                if not request.url.path.endswith("/__module_health__"):
                    module_id = match_module(request.url.path)
                    if module_id:
                        record_module_status(module_id, status_code)
                        if settings.MODULE_CIRCUIT_ENABLED:
                            await maybe_trip_module(module_id)
            except Exception:  # 模組健康計數失敗不可影響回應
                logger.debug("module health hook failed", exc_info=True)

    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        # 4xx 維持原樣（含 detail 訊息），5xx 統一遮蔽具體訊息
        if exc.status_code >= 500:
            err_id = uuid.uuid4().hex[:12]
            logger.error(
                "5xx HTTPException id=%s path=%s detail=%s",
                err_id,
                request.url.path,
                exc.detail,
                exc_info=True,
            )
            record_error(
                error_id=err_id,
                exc=exc,
                method=request.method,
                path=request.url.path,
                status_code=exc.status_code,
                category="http",
                request_id=getattr(request.state, "request_id", None),
                client_ip=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
            return JSONResponse(
                {"detail": "伺服器內部錯誤", "error_id": err_id},
                status_code=exc.status_code,
                headers=getattr(exc, "headers", None) or {},
            )
        return JSONResponse(
            {"detail": exc.detail},
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None) or {},
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            jsonable_encoder({"detail": "請求格式驗證失敗", "errors": exc.errors()}),
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        err_id = uuid.uuid4().hex[:12]
        logger.error(
            "Unhandled exception id=%s path=%s method=%s",
            err_id,
            request.url.path,
            request.method,
            exc_info=True,
        )
        record_error(
            error_id=err_id,
            exc=exc,
            method=request.method,
            path=request.url.path,
            status_code=500,
            request_id=getattr(request.state, "request_id", None),
            client_ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        return JSONResponse(
            {"detail": "伺服器內部錯誤", "error_id": err_id},
            status_code=500,
        )

    @app.get("/health", tags=["系統"], summary="健康檢查")
    async def health_check() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

    @app.get("/live", tags=["系統"], summary="存活檢查")
    async def liveness_check() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

    @app.get("/ready", tags=["系統"], summary="就緒檢查")
    async def readiness_check() -> JSONResponse:
        db_ok, db_error = await _check_database()
        redis_ok, redis_error = await _check_redis()
        checks = {
            "database": {"ok": db_ok, "error": db_error},
            "redis": {"ok": redis_ok, "error": redis_error},
        }
        status_code = 200 if db_ok and redis_ok else 503
        status = "ok" if status_code == 200 else "degraded"
        return JSONResponse(
            {"status": status, "version": settings.APP_VERSION, "checks": checks},
            status_code=status_code,
        )

    @app.get("/", tags=["系統"], summary="服務資訊")
    async def root_info() -> dict[str, str | bool | None]:
        return {
            "name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "status": "ok",
            "docs_url": app.docs_url,
            "debug": settings.DEBUG,
        }

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)
