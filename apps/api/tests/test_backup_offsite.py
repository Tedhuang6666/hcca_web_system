"""異地備份上傳：只上傳已加密檔案，失敗時回報原因而不拋出。"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

from api.core.config import settings
from api.services import backup_tasks


class _FakeS3:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.uploads: list[tuple[str, str, str, dict]] = []

    def upload_file(self, filename: str, bucket: str, key: str, ExtraArgs: dict) -> None:  # noqa: N803
        if self.fail:
            raise RuntimeError("network down")
        self.uploads.append((filename, bucket, key, ExtraArgs))


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3:
    client = _FakeS3()
    module = types.SimpleNamespace(client=lambda service, region_name=None: client)
    monkeypatch.setitem(sys.modules, "boto3", module)
    monkeypatch.setattr(settings, "BACKUP_S3_BUCKET", "hcca-offsite")
    monkeypatch.setattr(settings, "BACKUP_S3_PREFIX", "postgres/prod")
    return client


def test_encrypted_backup_is_uploaded_with_prefix(tmp_path: Path, fake_s3: _FakeS3) -> None:
    backup = tmp_path / "hcca_backup_db_20261117.dump.gpg"
    backup.write_bytes(b"ciphertext")
    reasons: list[str] = []

    key = backup_tasks._upload_offsite(backup, encrypted=True, reasons=reasons)

    assert key == "postgres/prod/hcca_backup_db_20261117.dump.gpg"
    assert reasons == []
    assert fake_s3.uploads[0][1:3] == ("hcca-offsite", key)
    assert fake_s3.uploads[0][3] == {"ServerSideEncryption": "AES256"}


def test_unencrypted_backup_never_leaves_the_host(tmp_path: Path, fake_s3: _FakeS3) -> None:
    backup = tmp_path / "hcca_backup_db_20261117.dump"
    backup.write_bytes(b"plaintext")
    reasons: list[str] = []

    key = backup_tasks._upload_offsite(backup, encrypted=False, reasons=reasons)

    assert key is None
    assert fake_s3.uploads == []
    assert reasons == ["未加密的備份不上傳異地"]


def test_upload_failure_is_reported_not_raised(tmp_path: Path, fake_s3: _FakeS3) -> None:
    fake_s3.fail = True
    backup = tmp_path / "hcca_backup_db_20261117.dump.gpg"
    backup.write_bytes(b"ciphertext")
    reasons: list[str] = []

    assert backup_tasks._upload_offsite(backup, encrypted=True, reasons=reasons) is None
    assert reasons == ["異地備份上傳失敗"]


def test_no_bucket_configured_skips_upload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "BACKUP_S3_BUCKET", "")
    reasons: list[str] = []

    assert backup_tasks._upload_offsite(tmp_path / "x.gpg", encrypted=True, reasons=reasons) is None
    assert reasons == []
