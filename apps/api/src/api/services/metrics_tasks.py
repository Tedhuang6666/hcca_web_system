"""Celery/Redis operational metric probes."""

from __future__ import annotations

from typing import cast

from redis import Redis

from api.core.celery_app import celery_app
from api.core.config import settings
from api.core.prometheus_metrics import set_queue_depth

_QUEUES = ("default", "email", "meal", "documents", "backup", "recovery", "celery")


@celery_app.task(
    name="api.services.metrics_tasks.collect_queue_depth",
    bind=True,
    max_retries=2,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def collect_queue_depth(self) -> dict[str, int]:  # type: ignore[type-arg]
    client = Redis.from_url(str(settings.REDIS_URL), decode_responses=True)
    try:
        depths = {queue: cast(int, client.llen(queue)) for queue in _QUEUES}
    finally:
        client.close()
    for queue, depth in depths.items():
        set_queue_depth(queue, depth)
    return depths


__all__ = ["collect_queue_depth"]
