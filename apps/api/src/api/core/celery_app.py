"""Celery 實例設定 - 使用 Redis 作為 Broker 與 Result Backend"""

from celery import Celery

from api.core.config import settings

celery_app = Celery(
    "campus_platform",
    broker=str(settings.REDIS_URL),
    backend=str(settings.REDIS_URL),
    # 明確列出包含 Task 的模組（Worker 啟動時自動載入）
    include=["api.services.mail"],
)

celery_app.conf.update(
    # --- 序列化 ---
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    # --- 時區 ---
    timezone="Asia/Taipei",
    enable_utc=True,
    # --- 任務行為 ---
    task_track_started=True,
    task_soft_time_limit=60,   # 超過 60s 拋出 SoftTimeLimitExceeded
    task_time_limit=120,        # 超過 120s 強制終止
    task_acks_late=True,        # Worker 完成後才 ACK，確保不丟失
    worker_prefetch_multiplier=1,  # 避免搶佔過多任務
    # --- Result 保留時間 ---
    result_expires=3600,  # 結果保留 1 小時
)
