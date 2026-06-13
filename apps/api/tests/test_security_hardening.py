from __future__ import annotations

import gzip
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.api_key import ApiKey
from api.models.user import User
from api.services import api_key, data_lifecycle, mfa, privacy


def _set_storage_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    backup_dir = tmp_path / "backups"
    monkeypatch.setattr(data_lifecycle.settings, "DB_BACKUP_DIR", str(backup_dir))
    monkeypatch.setattr(privacy.settings, "DB_BACKUP_DIR", str(backup_dir))
    return backup_dir


def test_archive_lookup_only_returns_listed_archive(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _set_storage_root(monkeypatch, tmp_path)
    archive = tmp_path / "archives" / "2026" / "06" / "audit_logs" / "batch.jsonl.gz"
    archive.parent.mkdir(parents=True)
    with gzip.open(archive, "wt", encoding="utf-8") as handle:
        handle.write('{"ok": true}\n')

    assert data_lifecycle.resolve_archive_file("2026/06/audit_logs/batch.jsonl.gz") == archive
    with pytest.raises(FileNotFoundError):
        data_lifecycle.resolve_archive_file("../../secret.jsonl.gz")


def test_archive_path_uses_internal_safe_segments(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _set_storage_root(monkeypatch, tmp_path)
    when = datetime(2026, 6, 13, tzinfo=UTC)

    archive, batch_id = data_lifecycle._archive_path_for("audit_logs_old", when)

    assert archive.parent == tmp_path / "archives" / "2026" / "06" / "audit_logs_old"
    assert archive.name == f"{batch_id}.jsonl.gz"
    with pytest.raises(ValueError):
        data_lifecycle._archive_path_for("../../secret", when)


def test_privacy_export_lookup_rejects_path_traversal(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _set_storage_root(monkeypatch, tmp_path)
    export = tmp_path / "privacy_exports" / "export_test.zip"
    export.parent.mkdir(parents=True)
    export.write_bytes(b"zip")

    assert privacy.read_export_bytes("export_test.zip") == b"zip"
    with pytest.raises(FileNotFoundError):
        privacy.read_export_bytes("../export_test.zip")


def test_sensitive_tokens_use_keyed_or_password_hashes() -> None:
    raw, key_hash = api_key.generate_raw_key()
    backup_hash = mfa._hash_backup_code("ABCD-EFGH")

    assert raw.startswith("hcca_")
    assert key_hash.startswith("scrypt:")
    assert api_key._verify_key(raw, key_hash)
    assert not api_key._verify_key(f"{raw}x", key_hash)
    assert backup_hash.startswith("scrypt:")
    assert "ABCD" not in backup_hash


@pytest.mark.asyncio
async def test_scrypt_api_key_authenticates(
    db_session: AsyncSession,
) -> None:
    raw = "hcca_" + "b" * 43
    owner = User(
        id=uuid.uuid4(),
        email="scrypt-key@example.com",
        display_name="Scrypt Key",
        is_verified=True,
    )
    row = ApiKey(
        name="scrypt",
        key_prefix=raw[:13],
        key_hash=api_key._hash_key(raw),
        owner_user_id=owner.id,
        scopes=[],
        rate_limit_per_minute=60,
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    db_session.add(row)
    await db_session.flush()

    authenticated = await api_key.find_active_by_raw(db_session, raw)

    assert authenticated is row


@pytest.mark.asyncio
async def test_legacy_api_key_is_rejected(
    db_session: AsyncSession,
) -> None:
    raw = "hcca_" + "a" * 43
    owner = User(
        id=uuid.uuid4(),
        email="legacy-key@example.com",
        display_name="Legacy Key",
        is_verified=True,
    )
    row = ApiKey(
        name="legacy",
        key_prefix=raw[:13],
        key_hash="legacy-digest",
        owner_user_id=owner.id,
        scopes=[],
        rate_limit_per_minute=60,
        is_active=True,
    )
    db_session.add(owner)
    await db_session.flush()
    db_session.add(row)
    await db_session.flush()

    authenticated = await api_key.find_active_by_raw(db_session, raw)

    assert authenticated is None
    assert row.key_hash == "legacy-digest"
