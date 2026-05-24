"""Gunicorn 生產設定 — UvicornWorker + 效能調優"""

import multiprocessing
import os

# ── Worker 設定 ───────────────────────────────────────────────────────────────

# UvicornWorker：支援 asyncio（ASGI），搭配 Gunicorn 提供多 worker 穩定性
worker_class = "uvicorn.workers.UvicornWorker"

# worker 數量：2 × CPU 核數 + 1（通用公式；I/O 密集應用可適度提高）
workers = int(os.getenv("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))

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

# 預先 fork 所有 worker（減少 fork 後的啟動延遲）
preload_app = True

# 最大請求數後自動重啟 worker（防止記憶體洩漏）
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "100"))

# ── 日誌 ─────────────────────────────────────────────────────────────────────

loglevel = os.getenv("LOG_LEVEL", "info")
accesslog = "-"   # stdout
errorlog = "-"    # stderr
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'
