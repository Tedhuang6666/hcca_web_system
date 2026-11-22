"""資料庫備份加密／校驗失敗時不得保留或上傳不安全產物。"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from api.core.config import settings
from api.services import backup_encryption, backup_tasks


def test_backup_database_discards_plaintext_and_alerts_when_gpg_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(settings, "DB_BACKUP_ENABLED", True)
    monkeypatch.setattr(settings, "DB_BACKUP_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "BACKUP_GPG_PASSPHRASE", "configured", raising=False)
    monkeypatch.setattr(settings, "BACKUP_VERIFY_SHA256", True)
    monkeypatch.setattr(
        backup_tasks, "_parse_database_url", lambda: ("backup", "", "db", 5432, "test")
    )
    monkeypatch.setattr(backup_encryption, "gpg_available", lambda: False)

    def write_dump(_command: list[str], *, stdout, **_kwargs) -> subprocess.CompletedProcess[str]:
        stdout.write(b"private dump")
        return subprocess.CompletedProcess(_command, 0)

    monkeypatch.setattr(backup_tasks.subprocess, "run", write_dump)
    runs: list[tuple[str, str]] = []
    alerts: list[dict[str, str]] = []
    monkeypatch.setattr(backup_tasks, "record_backup_run", lambda *args: runs.append(args))
    monkeypatch.setattr(
        backup_tasks, "_emit_backup_alert_sync", lambda **kwargs: alerts.append(kwargs)
    )
    monkeypatch.setattr(
        backup_tasks,
        "_upload_offsite",
        lambda *_args, **_kwargs: pytest.fail("不安全備份不得上傳異地"),
    )

    with pytest.raises(backup_encryption.BackupEncryptionError):
        backup_tasks.backup_database.run()

    assert list(tmp_path.glob("hcca_backup_*.dump*")) == []
    assert runs == [("database", "failed")]
    assert len(alerts) == 1
    assert "未上傳" in alerts[0]["body"]


def test_finalize_backup_removes_source_and_partial_output_when_encryption_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    target = tmp_path / "backup.dump"
    encrypted = tmp_path / "backup.dump.gpg"
    target.write_bytes(b"private dump")
    monkeypatch.setattr(backup_encryption, "is_encryption_configured", lambda: True)
    monkeypatch.setattr(backup_encryption, "gpg_available", lambda: True)

    def fail_encryption(src: Path, *, cleanup_src: bool) -> Path:
        assert src == target
        assert cleanup_src is True
        encrypted.write_bytes(b"partial encrypted data")
        raise backup_encryption.BackupEncryptionError("encryption failed")

    monkeypatch.setattr(backup_encryption, "encrypt_file", fail_encryption)

    with pytest.raises(backup_encryption.BackupEncryptionError, match="encryption failed"):
        backup_tasks._finalize_backup_artifact(target)

    assert not target.exists()
    assert not encrypted.exists()


def test_finalize_backup_removes_encrypted_artifact_when_hash_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    target = tmp_path / "backup.dump"
    encrypted = tmp_path / "backup.dump.gpg"
    target.write_bytes(b"private dump")
    monkeypatch.setattr(backup_encryption, "is_encryption_configured", lambda: True)
    monkeypatch.setattr(backup_encryption, "gpg_available", lambda: True)

    def encrypt(src: Path, *, cleanup_src: bool) -> Path:
        assert cleanup_src is True
        encrypted.write_bytes(b"encrypted data")
        src.unlink()
        return encrypted

    monkeypatch.setattr(backup_encryption, "encrypt_file", encrypt)
    monkeypatch.setattr(
        backup_encryption,
        "compute_sha256",
        lambda _path: (_ for _ in ()).throw(OSError("hash read failed")),
    )

    with pytest.raises(OSError, match="hash read failed"):
        backup_tasks._finalize_backup_artifact(target)

    assert not target.exists()
    assert not encrypted.exists()
