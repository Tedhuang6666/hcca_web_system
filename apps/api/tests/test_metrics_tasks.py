"""維運指標背景任務測試（apps/api/src/api/services/metrics_tasks.py）。"""

from __future__ import annotations

from pathlib import Path

import pytest

from api.services import metrics_tasks


def test_collect_queue_depth_returns_all_queues() -> None:
    depths = metrics_tasks.collect_queue_depth()
    assert set(depths.keys()) == set(metrics_tasks._QUEUES)  # noqa: SLF001
    assert all(isinstance(v, int) for v in depths.values())


def test_write_heartbeat_writes_timestamp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    heartbeat_path = tmp_path / "celery-heartbeat"
    monkeypatch.setattr(metrics_tasks, "_HEARTBEAT_PATH", heartbeat_path)

    metrics_tasks.write_heartbeat()

    assert heartbeat_path.exists()
    float(heartbeat_path.read_text())
