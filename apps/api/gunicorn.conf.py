"""Gunicorn 生產設定 — UvicornWorker + 效能調優"""

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from gunicorn.arbiter import Arbiter

# ── Worker 設定 ───────────────────────────────────────────────────────────────

# UvicornWorker：支援 asyncio（ASGI），搭配 Gunicorn 提供多 worker 穩定性
worker_class = "uvicorn.workers.UvicornWorker"

# worker 數量：受容器記憶體上限約束，部署環境可用 GUNICORN_WORKERS 覆寫。
# 正式 API 容器預設約 1.2 GiB；兩個 worker 的啟動峰值會觸發 cgroup OOM。
workers = int(os.getenv("GUNICORN_WORKERS", "1"))

# 每個 worker 的執行緒數（UvicornWorker 下無效，留 1 即可）
threads = 1

# ── 網路設定 ──────────────────────────────────────────────────────────────────

bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"

# Keep-alive：等待 Keep-Alive 連線的秒數
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# Backlog：最大待處理連線數（超過後系統拒絕新連線）
backlog = int(os.getenv("GUNICORN_BACKLOG", "2048"))

# ── 逾時設定 ──────────────────────────────────────────────────────────────────

# Worker 在被 master 殺掉前的最大靜默時間（秒）
# 耗時的 PDF/Excel/Email 應移到 Celery，避免 HTTP worker 長時間被占住
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))

# Graceful shutdown 的最長等待時間（秒）
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))

# ── 效能調優 ──────────────────────────────────────────────────────────────────

# 不要在 master process 建立 SQLAlchemy/async Redis 資源後再 fork。
# 這些 client 會攜帶 event-loop 與 connection-pool 狀態，preload 會讓 worker
# 共用 fork 前的 async 資源，造成 Redis/DB 連線異常與 worker boot timeout。
preload_app = False

# 預設不按請求數回收：健康檢查與前端輪詢也會計數，原本 1000 次的門檻
# 會頻繁重啟；worker 啟動約需十多秒，回收重疊時單一 API 容器會無法服務。
# 下方 hooks 也會在最終設定載入後強制歸零，避免環境或 CLI 覆寫重新啟用。
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "0"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "0"))


def _disable_request_count_recycling(server: "Arbiter") -> None:
    """啟動與 reload 都禁止請求配額回收；設定變更透過 blue-green 切換。"""
    if server.cfg.max_requests or server.cfg.max_requests_jitter:
        server.log.warning(
            "Request-count worker recycling is disabled; forcing max_requests and jitter to 0"
        )
    server.cfg.set("max_requests", 0)
    server.cfg.set("max_requests_jitter", 0)


on_starting = _disable_request_count_recycling
on_reload = _disable_request_count_recycling

# ── 日誌 ─────────────────────────────────────────────────────────────────────

loglevel = os.getenv("LOG_LEVEL", "info")
accesslog = "-"  # stdout
errorlog = "-"  # stderr
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'
