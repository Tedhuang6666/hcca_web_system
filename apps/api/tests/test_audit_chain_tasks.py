"""稽核 anchor 外部儲存測試。"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date

import boto3
import pytest

from api.core.config import settings
from api.models.audit_anchor import AuditLogAnchor
from api.services.audit_chain_tasks import _upload_anchor_to_s3


def _make_anchor() -> AuditLogAnchor:
    return AuditLogAnchor(
        anchor_date=date(2026, 10, 25),
        last_audit_log_id=uuid.UUID("a89c3b94-12b7-4d39-9422-c78b19d87341"),
        head_hash="a" * 64,
        log_count=4,
    )


def test_upload_anchor_is_skipped_without_a_bucket(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "BACKUP_S3_BUCKET", "  ")

    def unexpected_client(*_args: object, **_kwargs: object) -> None:
        pytest.fail("S3 client must not be created when no bucket is configured")

    monkeypatch.setattr(boto3, "client", unexpected_client)

    assert _upload_anchor_to_s3(_make_anchor()) is None


def test_upload_anchor_writes_deterministic_json_object(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(settings, "BACKUP_S3_BUCKET", "audit-archive")
    monkeypatch.setattr(settings, "BACKUP_S3_REGION", "us-west-2")
    monkeypatch.setattr(settings, "BACKUP_S3_PREFIX", "/production/records/")

    class FakeClient:
        def put_object(self, **kwargs: object) -> None:
            captured.update(kwargs)

    def fake_client(service: str, *, region_name: str) -> FakeClient:
        assert service == "s3"
        assert region_name == "us-west-2"
        return FakeClient()

    monkeypatch.setattr(boto3, "client", fake_client)

    result = _upload_anchor_to_s3(_make_anchor())
    body = captured["Body"]
    assert isinstance(body, bytes)
    payload = json.loads(body)

    assert result == "s3://audit-archive/production/records/audit-anchors/2026-10-25.json"
    assert captured["Bucket"] == "audit-archive"
    assert captured["Key"] == "production/records/audit-anchors/2026-10-25.json"
    assert payload == {
        "anchor_date": "2026-10-25",
        "head_hash": "a" * 64,
        "last_audit_log_id": "a89c3b94-12b7-4d39-9422-c78b19d87341",
        "log_count": 4,
    }
    metadata = captured["Metadata"]
    assert isinstance(metadata, dict)
    assert metadata["payload-sha256"] == hashlib.sha256(body).hexdigest()


def test_upload_anchor_propagates_s3_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "BACKUP_S3_BUCKET", "audit-archive")

    class FakeClient:
        def put_object(self, **_kwargs: object) -> None:
            raise RuntimeError("upload failed")

    monkeypatch.setattr(boto3, "client", lambda *_args, **_kwargs: FakeClient())

    with pytest.raises(RuntimeError, match="upload failed"):
        _upload_anchor_to_s3(_make_anchor())
