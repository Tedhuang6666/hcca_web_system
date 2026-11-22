"""備份加密與 sha256 校驗 helper 測試。"""

from __future__ import annotations

import hashlib

import pytest

from api.services import backup_encryption


def _set_passphrase(monkeypatch, value: str) -> None:
    from api.core.config import settings

    monkeypatch.setattr(settings, "BACKUP_GPG_PASSPHRASE", value, raising=False)


def test_is_configured_false_when_no_passphrase(monkeypatch):
    _set_passphrase(monkeypatch, "")
    assert backup_encryption.is_encryption_configured() is False


def test_is_configured_true_when_passphrase_set(monkeypatch):
    _set_passphrase(monkeypatch, "secret-pass")
    assert backup_encryption.is_encryption_configured() is True


def test_encrypt_raises_when_not_configured(monkeypatch, tmp_path):
    _set_passphrase(monkeypatch, "")
    src = tmp_path / "x.sql"
    src.write_text("dummy")
    with pytest.raises(backup_encryption.BackupEncryptionError):
        backup_encryption.encrypt_file(src)


def test_compute_sha256_matches_hashlib(tmp_path):
    src = tmp_path / "data.bin"
    payload = b"hello world\n" * 1000
    src.write_bytes(payload)

    expected = hashlib.sha256(payload).hexdigest()
    assert backup_encryption.compute_sha256(src) == expected


def test_verify_backup_file_returns_true_on_match(tmp_path):
    src = tmp_path / "data.bin"
    src.write_bytes(b"payload")
    sha = backup_encryption.compute_sha256(src)
    assert backup_encryption.verify_backup_file(src, sha) is True


def test_verify_backup_file_returns_false_on_mismatch(tmp_path):
    src = tmp_path / "data.bin"
    src.write_bytes(b"payload")
    assert backup_encryption.verify_backup_file(src, "deadbeef" * 8) is False


def test_verify_backup_file_returns_false_on_missing(tmp_path):
    missing = tmp_path / "nope.bin"
    assert backup_encryption.verify_backup_file(missing, "x" * 64) is False


def test_file_size_bytes(tmp_path):
    src = tmp_path / "data.bin"
    src.write_bytes(b"x" * 1234)
    assert backup_encryption.file_size_bytes(src) == 1234


@pytest.mark.skipif(
    not backup_encryption.gpg_available(),
    reason="gpg not available on this system",
)
def test_encrypt_then_decrypt_round_trip(monkeypatch, tmp_path):
    """有 gpg 時驗證加解密實際 round trip。"""
    _set_passphrase(monkeypatch, "test-passphrase-abc-123")
    src = tmp_path / "backup.sql"
    payload = b"-- Postgres dump\nINSERT INTO x VALUES (1);\n" * 500
    src.write_bytes(payload)
    expected_sha = backup_encryption.compute_sha256(src)

    encrypted = backup_encryption.encrypt_file(src, cleanup_src=False)
    assert encrypted.exists()
    assert encrypted.suffix == ".gpg"
    # 加密後檔案內容不同
    assert encrypted.read_bytes() != payload

    decrypted_path = tmp_path / "decrypted.sql"
    backup_encryption.decrypt_file(encrypted, out_path=decrypted_path)
    assert decrypted_path.exists()
    assert backup_encryption.compute_sha256(decrypted_path) == expected_sha


@pytest.mark.skipif(
    not backup_encryption.gpg_available(),
    reason="gpg not available on this system",
)
def test_encrypt_cleanup_src_removes_original(monkeypatch, tmp_path):
    _set_passphrase(monkeypatch, "abc")
    src = tmp_path / "to_encrypt.sql"
    src.write_text("data")
    encrypted = backup_encryption.encrypt_file(src, cleanup_src=True)
    assert encrypted.exists()
    assert not src.exists()
