"""欄位加密 helper 單元測試（Phase B3 / ADR-006）。"""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from api.core import field_crypto


@pytest.fixture(autouse=True)
def _reset_cipher_cache():
    """每個 test 前清掉 lru_cache，避免設定洩漏。"""
    field_crypto.reset_cipher_cache()
    yield
    field_crypto.reset_cipher_cache()


def _set_keys(monkeypatch, keys: list[str]) -> None:
    from api.core.config import settings

    monkeypatch.setattr(settings, "FIELD_ENCRYPTION_KEYS", keys, raising=False)
    field_crypto.reset_cipher_cache()


def test_is_configured_returns_false_when_no_keys(monkeypatch):
    _set_keys(monkeypatch, [])
    assert field_crypto.is_configured() is False


def test_is_configured_returns_true_when_key_set(monkeypatch):
    _set_keys(monkeypatch, [Fernet.generate_key().decode()])
    assert field_crypto.is_configured() is True


def test_encrypt_then_decrypt_round_trip(monkeypatch):
    _set_keys(monkeypatch, [Fernet.generate_key().decode()])
    plaintext = "TOTP_SECRET_VALUE_12345"
    token = field_crypto.encrypt_field(plaintext)
    assert token != plaintext
    assert field_crypto.decrypt_field(token) == plaintext


def test_encrypt_none_returns_none(monkeypatch):
    _set_keys(monkeypatch, [Fernet.generate_key().decode()])
    assert field_crypto.encrypt_field(None) is None
    assert field_crypto.encrypt_field("") == ""


def test_decrypt_none_returns_none(monkeypatch):
    _set_keys(monkeypatch, [Fernet.generate_key().decode()])
    assert field_crypto.decrypt_field(None) is None
    assert field_crypto.decrypt_field("") == ""


def test_encrypt_raises_when_not_configured(monkeypatch):
    _set_keys(monkeypatch, [])
    with pytest.raises(field_crypto.FieldEncryptionNotConfigured):
        field_crypto.encrypt_field("secret")


def test_decrypt_raises_when_not_configured(monkeypatch):
    _set_keys(monkeypatch, [])
    with pytest.raises(field_crypto.FieldEncryptionNotConfigured):
        field_crypto.decrypt_field("any-token")


def test_decrypt_invalid_token_raises(monkeypatch):
    _set_keys(monkeypatch, [Fernet.generate_key().decode()])
    with pytest.raises(field_crypto.FieldEncryptionError):
        field_crypto.decrypt_field("not-a-real-fernet-token")


def test_multi_key_can_decrypt_old_token(monkeypatch):
    old_key = Fernet.generate_key().decode()
    _set_keys(monkeypatch, [old_key])
    token = field_crypto.encrypt_field("rotated-value")

    new_key = Fernet.generate_key().decode()
    _set_keys(monkeypatch, [new_key, old_key])  # new first
    assert field_crypto.decrypt_field(token) == "rotated-value"


def test_rotate_re_encrypts_with_new_key(monkeypatch):
    old_key = Fernet.generate_key().decode()
    _set_keys(monkeypatch, [old_key])
    token = field_crypto.encrypt_field("rotate-me")

    new_key = Fernet.generate_key().decode()
    _set_keys(monkeypatch, [new_key, old_key])
    new_token = field_crypto.rotate_token(token)
    assert new_token != token
    assert field_crypto.decrypt_field(new_token) == "rotate-me"

    # 移除舊 key 後新 token 仍能解（因為已用新 key 加密）
    _set_keys(monkeypatch, [new_key])
    assert field_crypto.decrypt_field(new_token) == "rotate-me"


def test_generate_new_key_produces_valid_fernet_key():
    key = field_crypto.generate_new_key()
    # 應該能直接餵給 Fernet
    Fernet(key.encode())  # 不 raise 即可


def test_invalid_key_format_raises(monkeypatch):
    _set_keys(monkeypatch, ["not-a-base64-fernet-key"])
    with pytest.raises(field_crypto.FieldEncryptionError):
        field_crypto.encrypt_field("secret")
