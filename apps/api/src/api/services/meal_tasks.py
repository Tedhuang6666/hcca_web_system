"""學餐系統 Celery 定時任務 - 自動結單 / 未取餐追蹤"""

from __future__ import annotations

import asyncio
import logging

from api.core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="api.services.meal_tasks.auto_close_meal_schedules", bind=True, max_retries=3)
def auto_close_meal_schedules(self) -> dict:  # noqa: ANN001
    """
    Celery Beat 定時任務：自動關閉已過結單截止時間的菜單排程。

    預設每 5 分鐘執行一次（在 celery_app.py beat_schedule 中設定）。
    使用 asyncio.run() 呼叫 async service 函式。

    Returns:
        dict: {"closed_count": N} 本次關閉的排程數量
    """

    async def _run() -> int:
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

        from api.core.config import settings
        from api.services.meal import auto_close_expired_schedules

        engine = create_async_engine(str(settings.DATABASE_URL), echo=False)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            try:
                count = await auto_close_expired_schedules(session)
                await session.commit()
                return count
            except Exception:
                await session.rollback()
                raise
            finally:
                await engine.dispose()

    try:
        count = asyncio.run(_run())
        logger.info("[Celery Beat] 自動結單完成，共關閉 %d 個排程", count)
        return {"closed_count": count}
    except Exception as exc:
        logger.error("[Celery Beat] 自動結單失敗: %s", exc)
        raise self.retry(exc=exc, countdown=60) from exc


@celery_app.task(name="api.services.meal_tasks.check_meal_no_shows", bind=True, max_retries=3)
def check_meal_no_shows(self) -> dict:  # noqa: ANN001
    """
    Celery Beat 定時任務：偵測未取餐訂單並分兩階段處理。

    Phase 1 — 結單後 1 小時，訂單仍為 confirmed：
        → 寄提醒 Email 給使用者，設 reminder_sent_at

    Phase 2 — 結單後 4 小時，已發提醒仍未取：
        → 標記 is_no_show=True，寄通知給管理員信箱

    預設每 30 分鐘執行一次（在 celery_app.py beat_schedule 中設定）。
    """

    async def _run() -> dict:
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

        from api.core.config import settings
        from api.services.meal import check_and_handle_no_shows

        engine = create_async_engine(str(settings.DATABASE_URL), echo=False)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            try:
                result = await check_and_handle_no_shows(session)
                await session.commit()
                return result
            except Exception:
                await session.rollback()
                raise
            finally:
                await engine.dispose()

    try:
        result = asyncio.run(_run())
        logger.info(
            "[Celery Beat] 未取餐檢查完成 reminded=%d marked_no_show=%d",
            result.get("reminded", 0),
            result.get("marked_no_show", 0),
        )
        return result
    except Exception as exc:
        logger.error("[Celery Beat] 未取餐檢查失敗: %s", exc)
        raise self.retry(exc=exc, countdown=120) from exc
