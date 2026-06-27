"""Celery/Redis operational metric probes."""

from __future__ import annotations

import time
from pathlib import Path
from typing import cast

from redis import Redis

from api.core.celery_app import celery_app
from api.core.config import settings
from api.core.prometheus_metrics import set_queue_depth

_HEARTBEAT_PATH = Path("/tmp/celery-heartbeat")

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


@celery_app.task(
    name="api.services.metrics_tasks.write_heartbeat",
    bind=True,
    max_retries=0,
)
def write_heartbeat(self) -> None:  # type: ignore[type-arg]
    _HEARTBEAT_PATH.write_text(str(time.time()))


__all__ = ["collect_queue_depth", "write_heartbeat"]
