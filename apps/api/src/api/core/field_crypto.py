"""欄位級加密 helper（Fernet + MultiFernet），對應 ADR-006。

設計考量：
- 透明：service 層用 hybrid_property 包，呼叫端不感知加解密
- 可輪替：MultiFernet 接受 list，new key 在前，舊 key 仍能解
- 失敗安全：FIELD_ENCRYPTION_KEYS 未設定時，呼叫 encrypt/decrypt 會 raise
  以避免明文意外寫入「以為加密」的欄位

使用範例（model）：
    from api.core.field_crypto import encrypt_field, decrypt_field
    from sqlalchemy.ext.hybrid import hybrid_property

    class UserMFA(Base):
        _totp_secret_enc: Mapped[str | None] = mapped_column("totp_secret_enc")

        @hybrid_property
        def totp_secret(self) -> str | None:
            return decrypt_field(self._totp_secret_enc)

        @totp_secret.setter
        def totp_secret(self, value: str | None) -> None:
            self._totp_secret_enc = encrypt_field(value)

輪替流程：
1. 產生新 key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
2. env: FIELD_ENCRYPTION_KEYS="<new>,<old>"
3. 漸進 re-encrypt（Celery beat 掃舊資料、讀+寫一次即用新 key 重新加密）
4. 完成後 env 改為 FIELD_ENCRYPTION_KEYS="<new>"
"""

from __future__ import annotations

import logging
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from api.core.config import settings

logger = logging.getLogger(__name__)


class FieldEncryptionError(RuntimeError):
    """欄位加解密相關錯誤的統一例外。"""


class FieldEncryptionNotConfigured(FieldEncryptionError):
    """FIELD_ENCRYPTION_KEYS 未設定時呼叫 encrypt/decrypt 會 raise 此例外。

    刻意 fail-loud，避免明文落地。
    """


@lru_cache(maxsize=1)
def _get_cipher() -> MultiFernet | None:
    """讀 settings.FIELD_ENCRYPTION_KEYS 建立 MultiFernet。

    為效能考量 lru_cache 一次。輪替 key 後請呼叫 `reset_cipher_cache()`
    讓設定生效（也可整體重啟 process）。
    """
    keys = [k.strip() for k in settings.FIELD_ENCRYPTION_KEYS if k and k.strip()]
    if not keys:
        return None
    try:
        fernets = [Fernet(k.encode() if isinstance(k, str) else k) for k in keys]
    except (ValueError, TypeError) as exc:
        raise FieldEncryptionError(
            f"FIELD_ENCRYPTION_KEYS 內容不是合法 Fernet base64 key：{exc}"
        ) from exc
    return MultiFernet(fernets)


def reset_cipher_cache() -> None:
    """清掉 _get_cipher 的 cache，下次重新讀 settings。輪替後呼叫。"""
    _get_cipher.cache_clear()


def is_configured() -> bool:
    """欄位加密目前是否可用。用於 startup 檢查。"""
    return _get_cipher() is not None


def encrypt_field(plaintext: str | None) -> str | None:
    """加密一段字串。None / 空字串原樣回傳（不視為錯誤）。

    Raises:
        FieldEncryptionNotConfigured: FIELD_ENCRYPTION_KEYS 未設定
        FieldEncryptionError: Fernet 加密失敗（極少見）
    """
    if plaintext is None or plaintext == "":
        return plaintext
    cipher = _get_cipher()
    if cipher is None:
        raise FieldEncryptionNotConfigured(
            "FIELD_ENCRYPTION_KEYS 未設定，無法加密敏感欄位。"
            "請檢查 .env 或 docker-compose.prod.yml。"
        )
    try:
        token = cipher.encrypt(plaintext.encode("utf-8"))
        return token.decode("ascii")
    except Exception as exc:
        raise FieldEncryptionError(f"加密失敗：{exc}") from exc


def decrypt_field(token: str | None) -> str | None:
    """解密一段密文。None / 空字串原樣回傳。

    自動嘗試所有 keys（MultiFernet 內建）。

    Raises:
        FieldEncryptionNotConfigured: FIELD_ENCRYPTION_KEYS 未設定
        FieldEncryptionError: token 無效或所有 keys 都解不開
    """
    if not token:
        return token
    cipher = _get_cipher()
    if cipher is None:
        raise FieldEncryptionNotConfigured("FIELD_ENCRYPTION_KEYS 未設定，無法解密既有加密欄位。")
    try:
        plaintext = cipher.decrypt(token.encode("ascii"))
        return plaintext.decode("utf-8")
    except InvalidToken as exc:
        # 不洩漏 token 內容到 log
        raise FieldEncryptionError(
            "解密失敗：所有 key 皆無法解開。可能是 key 已被輪替移除，或欄位內容已損壞。"
        ) from exc


def rotate_token(token: str | None) -> str | None:
    """用最新 key 重新加密一段已加密 token。

    Re-encrypt batch job 會逐筆呼叫此函式：
        for row in stale_rows:
            row.field_enc = rotate_token(row.field_enc)

    在 MultiFernet 下，rotate 等同於「用第一個 key 重新加密」。
    """
    if not token:
        return token
    cipher = _get_cipher()
    if cipher is None:
        raise FieldEncryptionNotConfigured("FIELD_ENCRYPTION_KEYS 未設定，無法執行 rotate")
    try:
        new_token = cipher.rotate(token.encode("ascii"))
        return new_token.decode("ascii")
    except InvalidToken as exc:
        raise FieldEncryptionError("rotate 失敗：來源 token 無法解密") from exc


def generate_new_key() -> str:
    """產生一把新 Fernet key（base64 字串）。用於密鑰輪替起手式。"""
    return Fernet.generate_key().decode("ascii")


__all__ = [
    "FieldEncryptionError",
    "FieldEncryptionNotConfigured",
    "decrypt_field",
    "encrypt_field",
    "generate_new_key",
    "is_configured",
    "reset_cipher_cache",
    "rotate_token",
]
