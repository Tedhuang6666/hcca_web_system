"""Celery 實例設定 - 使用 Redis 作為 Broker 與 Result Backend"""

from celery import Celery
from celery.schedules import crontab
from kombu import Queue

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
    # --- 多 queue 隔離：單一模組任務阻塞不會拖累其他模組 ---
    task_default_queue="default",
    task_queues=(
        Queue("default"),
        Queue("email"),
        Queue("meal"),
        Queue("backup"),
        Queue("documents"),
        Queue("recovery"),
    ),
    task_routes={
        "api.services.mail.*": {"queue": "email"},
        "api.services.email_tasks.*": {"queue": "email"},
        "api.services.digest_tasks.*": {"queue": "email"},
        "api.services.meal_tasks.*": {"queue": "meal"},
        "api.services.backup_tasks.*": {"queue": "backup"},
        "api.services.recovery_tasks.*": {"queue": "recovery"},
    },
)

# ── Celery Beat 定時任務排程 ──────────────────────────────────────────────────
celery_app.conf.include = list(celery_app.conf.include or []) + [
    "api.services.outbox_tasks",
    "api.services.regulation_tasks",
    "api.services.email_tasks",
    "api.services.shop_tasks",
    "api.services.meeting_tasks",
    "api.services.backup_tasks",
    "api.services.permission_tasks",
    "api.services.digest_tasks",
    "api.services.work_item_tasks",
    "api.services.recovery_tasks",
    "api.services.data_lifecycle_tasks",
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
    # 每 60 秒寄出已到期的預約郵件
    "process-scheduled-emails-every-60s": {
        "task": "api.services.email_tasks.process_scheduled_emails",
        "schedule": 60.0,
    },
    # 每 5 分鐘檢查剛截止的校商商品，通知班級幹部結單
    "notify-class-cadres-on-deadline-every-5min": {
        "task": "api.services.shop_tasks.notify_class_cadres_on_deadline",
        "schedule": 300.0,
    },
    # 每 60 秒檢查即將開始的會議並推播開會提醒
    "send-meeting-start-reminders-every-60s": {
        "task": "api.services.meeting_tasks.send_meeting_start_reminders",
        "schedule": 60.0,
    },
    # 每日凌晨 3:00 進行資料庫備份（需 DB_BACKUP_ENABLED=true）
    "backup-database-daily-at-3am": {
        "task": "api.services.backup_tasks.backup_database",
        "schedule": crontab(hour="3", minute="0"),
        "options": {"soft_time_limit": 540, "time_limit": 600},
    },
    # 每日凌晨 0:10 清除過期任期使用者的權限快取
    "invalidate-expired-user-caches-daily": {
        "task": "api.services.permission_tasks.invalidate_expired_user_caches",
        "schedule": crontab(hour="0", minute="10"),
    },
    # 每日 08:00 寄送通知摘要 Email（過去 24 小時未讀通知聚合）
    "send-daily-digest-at-8am": {
        "task": "api.services.digest_tasks.send_daily_digest",
        "schedule": crontab(hour="8", minute="0"),
    },
    # 每週一 08:00 寄送週通知摘要 Email（過去 7 天未讀通知聚合）
    "send-weekly-digest-monday-8am": {
        "task": "api.services.digest_tasks.send_weekly_digest",
        "schedule": crontab(hour="8", minute="0", day_of_week="1"),
    },
    # 每 10 分鐘提醒 24 小時內到期或已逾期的工作分配
    "remind-due-work-items-every-10min": {
        "task": "api.services.work_item_tasks.remind_due_work_items",
        "schedule": 600.0,
    },
    # half-open 模組探測：掃 module_probe_queue ZSET 並嘗試恢復維護中的模組
    "process-half-open-probes": {
        "task": "api.services.recovery_tasks.process_half_open_probes",
        "schedule": float(settings.MODULE_PROBE_INTERVAL_SECONDS),
    },
    # 每週一凌晨 4:00 清理已讀通知與已處理 outbox 事件（safe 規則自動執行）
    # archive_then_purge / dangerous 規則一律保留為手動觸發
    "data-lifecycle-auto-purge-weekly": {
        "task": "api.services.data_lifecycle_tasks.run_safe_purges",
        "schedule": crontab(hour="4", minute="0", day_of_week="1"),
    },
}

# Lifecycle 任務路由到 backup queue（同樣是低頻、可長跑、不阻塞線上請求）
celery_app.conf.task_routes["api.services.data_lifecycle_tasks.*"] = {"queue": "backup"}
