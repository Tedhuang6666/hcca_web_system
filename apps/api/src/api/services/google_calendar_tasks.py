"""Google Calendar 同步 Celery Tasks。

push_event:    即時推送單一事件到 Google Calendar（由 calendar.py service 觸發）
pull_all_orgs: Celery Beat 每 5 分鐘定期拉取所有已連結組織的 Google Calendar 變更
"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="api.services.google_calendar_tasks.push_event",
    bind=True,
    max_retries=3,
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    soft_time_limit=30,
    time_limit=60,
)
def push_event(self, event_id: str, operation: str, org_id: str) -> dict:  # noqa: ANN001
    """推送單一 HCCA 事件變更到 Google Calendar。

    Args:
        event_id:  CalendarEvent UUID（字串）
        operation: "create" | "update" | "delete"
        org_id:    Org UUID（字串）

    由 calendar service 的 create_event / update_event / delete_event 觸發。
    若 org 尚未連結 Google Calendar，此 task 不執行（get_config_for_org 回 None）。
    """

    async def _run() -> dict:
        import uuid

        from sqlalchemy import select

        from api.core.database import task_session
        from api.models.calendar import CalendarEvent
        from api.services.google_calendar_service import (
            GoogleCalendarAuthError,
            get_config_for_org,
            push_event_to_google,
        )

        event_uuid = uuid.UUID(event_id)
        org_uuid = uuid.UUID(org_id)

        async with task_session() as session:
            try:
                config = await get_config_for_org(session, org_uuid)
                if config is None:
                    return {"skipped": "no_config"}

                event = await session.scalar(
                    select(CalendarEvent).where(CalendarEvent.id == event_uuid)
                )
                if event is None:
                    return {"skipped": "event_not_found"}

                google_event_id = await push_event_to_google(
                    session, event, config, operation=operation
                )
                await session.commit()
                return {"google_event_id": google_event_id, "operation": operation}
            except GoogleCalendarAuthError as exc:
                logger.warning("[GoogleCalendar push] org=%s token 失效：%s", org_id, exc)
                await session.rollback()
                return {"error": "auth_error", "detail": str(exc)}
            except Exception:
                await session.rollback()
                raise

    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error(
            "[GoogleCalendar push] 失敗 event=%s operation=%s: %s", event_id, operation, exc
        )
        raise self.retry(exc=exc) from exc


@celery_app.task(
    name="api.services.google_calendar_tasks.pull_all_orgs",
    bind=True,
    max_retries=2,
    soft_time_limit=240,
    time_limit=300,
)
def pull_all_orgs(self) -> dict:  # noqa: ANN001
    """定期從所有已連結的 Google Calendar 增量拉取事件並更新投影。

    由 Celery Beat 每 5 分鐘觸發一次。
    每個 org 獨立處理，失敗不影響其他 org。
    """

    async def _run() -> dict:
        from sqlalchemy import select

        from api.core.database import task_session
        from api.models.google_calendar import OrgGoogleCalendarConfig
        from api.services.google_calendar_service import (
            GoogleCalendarAuthError,
            pull_from_google,
        )

        total = {"orgs": 0, "created": 0, "updated": 0, "deleted": 0, "errors": 0}

        async with task_session() as session:
            configs = (
                await session.scalars(
                    select(OrgGoogleCalendarConfig).where(
                        OrgGoogleCalendarConfig.is_active.is_(True),
                        OrgGoogleCalendarConfig.sync_enabled.is_(True),
                        OrgGoogleCalendarConfig.refresh_token_enc.isnot(None),
                    )
                )
            ).all()

            for config in configs:
                total["orgs"] += 1
                try:
                    stats = await pull_from_google(session, config)
                    await session.commit()
                    for key in ("created", "updated", "deleted", "errors"):
                        total[key] += stats.get(key, 0)
                    logger.info("[GoogleCalendar pull] org=%s 完成：%s", config.org_id, stats)
                except GoogleCalendarAuthError as exc:
                    await session.rollback()
                    logger.warning(
                        "[GoogleCalendar pull] org=%s token 失效：%s", config.org_id, exc
                    )
                    total["errors"] += 1
                except Exception:
                    await session.rollback()
                    logger.exception("[GoogleCalendar pull] org=%s 發生未預期錯誤", config.org_id)
                    total["errors"] += 1

        return total

    try:
        result = asyncio.run(_run())
        logger.info("[GoogleCalendar pull] 全部完成：%s", result)
        return result
    except Exception as exc:
        logger.error("[GoogleCalendar pull] task 失敗: %s", exc)
        raise self.retry(exc=exc) from exc
