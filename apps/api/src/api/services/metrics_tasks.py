"""Celery/Redis operational metric probes."""

from __future__ import annotations

import time
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import cast

from redis import Redis

from api.core.celery_app import celery_app
from api.core.config import settings
from api.core.prometheus_metrics import set_queue_depth

# Worker image 的 /app 對非 root 使用者不可寫；/tmp 是容器內的共用可寫路徑。
_HEARTBEAT_PATH = Path("/tmp/celery-heartbeat")

_QUEUES = ("default", "email", "documents", "backup", "recovery", "celery")


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
    # 在同目錄建立私有暫存檔，再原子替換目錄項目；不跟隨既有 symlink／hardlink，
    # healthcheck 也不會讀到 truncate 後尚未寫完的空檔。
    with NamedTemporaryFile(
        mode="w", dir=_HEARTBEAT_PATH.parent, prefix=".hcca-heartbeat-", delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
        try:
            temporary.write(str(time.time()))
            temporary.flush()
            temporary_path.replace(_HEARTBEAT_PATH)
        finally:
            temporary_path.unlink(missing_ok=True)


__all__ = ["collect_queue_depth", "write_heartbeat"]
