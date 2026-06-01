"""Celery 實例設定 - 使用 Redis 作為 Broker 與 Result Backend"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from celery import Celery
from celery.schedules import crontab
from celery.signals import setup_logging, task_failure, task_retry, task_success
from kombu import Queue
from redis import Redis

from api.core.config import settings
from api.core.structured_logging import configure_logging


# Celery 預設會在 worker / beat 啟動時自行接管 logging（覆蓋我們的 formatter，
# 印出 `[2026-... WARNING/ForkPoolWorker-1]` 那種樣式）。連上 setup_logging signal
# 就會阻止它接管，並由我們 configure_logging 提供統一格式。
@setup_logging.connect
def _configure_celery_logging(**_kwargs):  # type: ignore[no-untyped-def]
    configure_logging()


# 模組載入時也跑一次，cover 非 worker 進程（例如 beat / inspect / pytest 直接 import）
configure_logging()

logger = logging.getLogger(__name__)

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
    task_reject_on_worker_lost=True,  # worker 被 kill 時交還 broker，不默默吞掉任務
    worker_prefetch_multiplier=1,  # 避免搶佔過多任務
    task_default_retry_delay=60,
    broker_transport_options={
        "visibility_timeout": 3600,
        "socket_timeout": settings.REDIS_SOCKET_TIMEOUT,
        "socket_connect_timeout": settings.REDIS_SOCKET_TIMEOUT,
    },
    # Celery 5.3+：原本 broker_connection_retry 同時管「啟動時」與「執行期」重試；
    # 6.0 起拆成兩個設定，未明示就會印 CPendingDeprecationWarning 洗 log。
    broker_connection_retry_on_startup=True,
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
    "api.services.audit_chain_tasks",
    "api.services.field_crypto_tasks",
    "api.services.webhook_tasks",
    "api.services.document_reminder_tasks",
    "api.services.watchdog_tasks",
    "api.services.discord_reminders",
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
    # 每日 00:05 產生昨日 audit log anchor（Phase B2 / ADR-004）
    "audit-anchor-daily-at-0005": {
        "task": "api.services.audit_chain_tasks.compute_daily_audit_anchor",
        "schedule": crontab(hour="0", minute="5"),
    },
    # 每週六 03:00 完整性掃描最近 7 天 audit chain
    "audit-chain-integrity-weekly-saturday": {
        "task": "api.services.audit_chain_tasks.verify_audit_chain_integrity",
        "schedule": crontab(hour="3", minute="0", day_of_week="6"),
        "kwargs": {"days": 7},
    },
    # 每 30 秒派發 due 的 webhook 投遞（Phase D2）
    "dispatch-webhook-deliveries-every-30s": {
        "task": "api.services.webhook_tasks.process_webhook_deliveries",
        "schedule": 30.0,
    },
    # 每日 08:00 公文逾期自動催辦 + 升級（Phase C1）
    "send-document-reminders-daily-at-8am": {
        "task": "api.services.document_reminder_tasks.send_document_reminders",
        "schedule": crontab(hour="8", minute="0"),
    },
    # 平台健康巡邏：磁碟、備份新鮮度、outbox dead 累積
    # 跨門檻才發告警，恢復後發一次解除（避免洗版）
    "watchdog-every-10min": {
        "task": "api.services.watchdog_tasks.run_watchdog",
        "schedule": 600.0,
    },
    # Discord 個人摘要 DM（每日 08:00 / 週日 20:00 台北）
    "discord-daily-digest-at-0am-utc": {
        "task": "api.services.discord_reminders.send_daily_digest",
        "schedule": crontab(hour="0", minute="0"),  # 台北 08:00 = UTC 00:00
    },
    "discord-weekly-digest-sunday-12-utc": {
        "task": "api.services.discord_reminders.send_weekly_digest",
        "schedule": crontab(hour="12", minute="0", day_of_week="0"),  # 台北週日 20:00
    },
    # Discord 行事曆 T-1h / T-24h 個人提醒掃描
    "discord-reminder-sweep-every-15min": {
        "task": "api.services.discord_reminders.reminder_sweep",
        "schedule": 900.0,
    },
}

# Lifecycle 任務路由到 backup queue（同樣是低頻、可長跑、不阻塞線上請求）
celery_app.conf.task_routes["api.services.data_lifecycle_tasks.*"] = {"queue": "backup"}
celery_app.conf.task_routes["api.services.watchdog_tasks.*"] = {"queue": "backup"}


def _task_payload(sender, **kwargs) -> dict:
    request = getattr(sender, "request", None)
    delivery_info = getattr(request, "delivery_info", None) or {}
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "task": getattr(sender, "name", None),
        "task_id": getattr(request, "id", None),
        "queue": delivery_info.get("routing_key") if isinstance(delivery_info, dict) else None,
        "retries": getattr(request, "retries", None),
        "args": [str(arg)[:200] for arg in getattr(request, "args", ()) or ()],
        "kwargs": {
            str(key): str(value)[:200]
            for key, value in (getattr(request, "kwargs", {}) or {}).items()
        },
        **kwargs,
    }


def _push_dead_letter(payload: dict) -> None:
    if not settings.CELERY_DLQ_ENABLED:
        return
    try:
        client = Redis.from_url(str(settings.REDIS_URL), decode_responses=True)
        pipe = client.pipeline()
        pipe.lpush(settings.CELERY_DLQ_REDIS_KEY, json.dumps(payload, ensure_ascii=False))
        pipe.ltrim(settings.CELERY_DLQ_REDIS_KEY, 0, settings.CELERY_DLQ_MAX_ITEMS - 1)
        pipe.execute()
        client.close()
    except Exception:
        logger.exception("failed to persist celery dead-letter payload")


@task_retry.connect
def _log_task_retry(sender=None, request=None, reason=None, einfo=None, **_kwargs) -> None:
    logger.warning(
        "Celery task retry scheduled",
        extra={
            "event": "celery.retry",
            "task": getattr(sender, "name", None),
            "task_id": getattr(request, "id", None),
            "retries": getattr(request, "retries", None),
            "reason": str(reason)[:500],
        },
    )


@task_failure.connect
def _record_task_failure(
    sender=None,
    task_id=None,
    exception=None,
    traceback=None,
    einfo=None,
    **_kwargs,
) -> None:
    payload = _task_payload(
        sender,
        status="failed",
        task_id=task_id,
        exception_type=exception.__class__.__name__ if exception else None,
        exception=str(exception)[:1000] if exception else None,
    )
    logger.error(
        "Celery task failed",
        extra={
            "event": "celery.failure",
            "task": payload.get("task"),
            "task_id": payload.get("task_id") or task_id,
            "exception_type": payload.get("exception_type"),
        },
    )
    _push_dead_letter(payload)


@task_success.connect
def _log_task_success(sender=None, result=None, **_kwargs) -> None:
    logger.info(
        "Celery task completed",
        extra={
            "event": "celery.success",
            "task": getattr(sender, "name", None),
            "result_preview": str(result)[:300],
        },
    )
