"""Celery 實例設定 - 使用 Redis 作為 Broker 與 Result Backend"""

from celery import Celery

from api.core.config import settings

celery_app = Celery(
    "campus_platform",
    broker=str(settings.REDIS_URL),
    backend=str(settings.REDIS_URL),
    # 明確列出包含 Task 的模組（Worker 啟動時自動載入）
    include=[
        "api.services.mail",
        "api.services.meal_tasks",
        "api.services.regulation_tasks",
    ],
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
    task_soft_time_limit=60,  # 超過 60s 拋出 SoftTimeLimitExceeded
    task_time_limit=120,  # 超過 120s 強制終止
    task_acks_late=True,  # Worker 完成後才 ACK，確保不丟失
    worker_prefetch_multiplier=1,  # 避免搶佔過多任務
    # --- Result 保留時間 ---
    result_expires=3600,  # 結果保留 1 小時
)

# ── Celery Beat 定時任務排程 ──────────────────────────────────────────────────
celery_app.conf.include = list(celery_app.conf.include or []) + [
    "api.services.outbox_tasks",
    "api.services.regulation_tasks",
]

celery_app.conf.beat_schedule = {
    # 每 30 秒掃 outbox pending 事件並處理
    "process-outbox-events-every-30s": {
        "task": "api.services.outbox_tasks.process_outbox",
        "schedule": 30.0,
    },
    # 每 5 分鐘自動結單（學餐系統）
    "auto-close-meal-schedules-every-5min": {
        "task": "api.services.meal_tasks.auto_close_meal_schedules",
        "schedule": 300.0,
    },
    # 每 30 分鐘檢查未取餐（Phase1: 1h後寄提醒, Phase2: 4h後標記 no_show）
    "check-meal-no-shows-every-30min": {
        "task": "api.services.meal_tasks.check_meal_no_shows",
        "schedule": 1800.0,
        # B7: 此任務可能遍歷大量訂單，獨立設定較長的 soft limit
        "options": {"soft_time_limit": 300, "time_limit": 360},
    },
    # 每日巡檢法規與公布令一致性（24 小時）
    "audit-regulation-consistency-daily": {
        "task": "api.services.regulation_tasks.audit_regulation_consistency",
        "schedule": 86400.0,
    },
}
