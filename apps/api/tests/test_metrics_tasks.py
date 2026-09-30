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


@pytest.mark.parametrize("link_kind", ["symlink", "hardlink"])
def test_heartbeat_does_not_overwrite_link_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, link_kind: str
) -> None:
    protected = tmp_path / "unrelated-file"
    protected.write_text("must remain unchanged")
    heartbeat = tmp_path / "celery-heartbeat"
    if link_kind == "symlink":
        heartbeat.symlink_to(protected)
    else:
        heartbeat.hardlink_to(protected)
    monkeypatch.setattr(metrics_tasks, "_HEARTBEAT_PATH", heartbeat)

    metrics_tasks.write_heartbeat()

    assert protected.read_text() == "must remain unchanged"
    assert not heartbeat.is_symlink()
    float(heartbeat.read_text())
    assert not list(tmp_path.glob(".hcca-heartbeat-*"))


def test_heartbeat_cleans_temporary_file_when_replace_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    heartbeat = tmp_path / "celery-heartbeat"
    heartbeat.mkdir()
    monkeypatch.setattr(metrics_tasks, "_HEARTBEAT_PATH", heartbeat)

    with pytest.raises(IsADirectoryError):
        metrics_tasks.write_heartbeat()

    assert heartbeat.is_dir()
    assert not list(tmp_path.glob(".hcca-heartbeat-*"))
