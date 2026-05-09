"""Outbox Celery tasks — 週期性掃描並發送 pending 事件"""

from api.core.celery_app import celery_app


@celery_app.task(name="api.services.outbox_tasks.process_outbox", bind=True, max_retries=0)
def process_outbox(self) -> dict:  # type: ignore[type-arg]
    """掃描 outbox_events 中 status=pending 的事件並依 event_type 分派。"""
    from api.services.outbox import process_pending_outbox

    process_pending_outbox()
    return {"status": "ok"}
