"""2FA (TOTP) 服務 - 啟用/停用/驗證多因素認證"""

import base64
import hashlib
import hmac
import logging
import secrets

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.user import User

logger = logging.getLogger(__name__)

_ENCRYPTED_PREFIX = "enc:v1:"
_BACKUP_CODE_COUNT = 8


def _fernet() -> Fernet:
    material = settings.MFA_SECRET_ENCRYPTION_KEY or settings.SECRET_KEY
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_mfa_secret(secret: str) -> str:
    """加密 TOTP secret 後再存入資料庫。"""
    token = _fernet().encrypt(secret.encode("utf-8")).decode("ascii")
    return f"{_ENCRYPTED_PREFIX}{token}"


def decrypt_mfa_secret(stored: str | None) -> str | None:
    """解密 TOTP secret；舊明文資料向前相容。"""
    if not stored:
        return None
    if not stored.startswith(_ENCRYPTED_PREFIX):
        return stored
    token = stored.removeprefix(_ENCRYPTED_PREFIX).encode("ascii")
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        logger.exception("MFA secret decryption failed")
        return None


def _normalize_code(code: str) -> str:
    return code.strip().replace("-", "").replace(" ", "").upper()


def _hash_backup_code(code: str) -> str:
    normalized = _normalize_code(code)
    digest = hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"sha256:{digest}"


def _generate_backup_codes() -> list[str]:
    return [secrets.token_hex(4).upper() for _ in range(_BACKUP_CODE_COUNT)]


def _hashes_payload(codes: list[str]) -> dict[str, list[str]]:
    return {"codes": [_hash_backup_code(code) for code in codes]}


def backup_code_count(user: User) -> int:
    return len((user.mfa_backup_code_hashes or {}).get("codes", []))


def _pyotp():
    """延遲導入 pyotp（避免啟動時報錯，安裝後自動生效）"""
    try:
        import pyotp
        return pyotp
    except ImportError as e:
        raise ImportError(
            "pyotp 未安裝，請執行：uv add pyotp --project apps/api"
        ) from e


def generate_totp_secret() -> str:
    """生成 TOTP 秘鑰"""
    pyotp = _pyotp()
    return pyotp.random_base32()


def generate_totp_provisioning_uri(secret: str, email: str, issuer: str = "HCCA") -> str:
    """生成 TOTP 配置 URI（用於 QR Code 或 authenticator app）"""
    pyotp = _pyotp()
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def verify_totp_code(secret: str, code: str) -> bool:
    """驗證 TOTP 碼（允許前後 1 個時間窗口的偏差）"""
    pyotp = _pyotp()
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


def _consume_backup_code(user: User, code: str) -> bool:
    stored = list((user.mfa_backup_code_hashes or {}).get("codes", []))
    if not stored:
        return False
    candidate = _hash_backup_code(code)
    for index, item in enumerate(stored):
        if hmac.compare_digest(candidate, item):
            del stored[index]
            user.mfa_backup_code_hashes = {"codes": stored}
            return True
    return False


async def setup_mfa(db: AsyncSession, user: User) -> dict:
    """
    初始化 2FA 設定，生成待確認的秘鑰

    Returns:
        {"secret": ..., "qr_uri": ..., "backup_codes": [...]}
    """
    secret = generate_totp_secret()
    backup_codes = _generate_backup_codes()
    user.mfa_pending_secret = encrypt_mfa_secret(secret)
    user.mfa_pending_backup_code_hashes = _hashes_payload(backup_codes)

    logger.info("MFA setup initiated", extra={"user_id": str(user.id)})

    return {
        "secret": secret,
        "qr_uri": generate_totp_provisioning_uri(secret, user.email),
        "backup_codes": backup_codes,
    }


async def confirm_mfa(db: AsyncSession, user: User, code: str) -> bool:
    """
    確認 2FA 啟用（驗證第一組 TOTP 碼後正式啟用）

    Returns True if activation successful
    """
    if not user.mfa_pending_secret:
        return False

    pending_secret = decrypt_mfa_secret(user.mfa_pending_secret)
    if not pending_secret or not verify_totp_code(pending_secret, code):
        logger.warning("MFA confirmation failed", extra={"user_id": str(user.id)})
        return False

    user.mfa_secret = user.mfa_pending_secret
    user.mfa_pending_secret = None
    user.mfa_backup_code_hashes = user.mfa_pending_backup_code_hashes or {}
    user.mfa_pending_backup_code_hashes = {}
    user.mfa_enabled = True

    logger.info("MFA enabled successfully", extra={"user_id": str(user.id)})
    return True


async def verify_mfa(db: AsyncSession, user: User, code: str) -> bool:
    """驗證使用者的 TOTP 或備用碼；備用碼成功後立即作廢。"""
    if not user.mfa_enabled or not user.mfa_secret:
        return True  # 未啟用 2FA 的用戶直接通過

    secret = decrypt_mfa_secret(user.mfa_secret)
    if secret and verify_totp_code(secret, code):
        return True
    if _consume_backup_code(user, code):
        await db.flush()
        return True
    return False


async def regenerate_backup_codes(db: AsyncSession, user: User, code: str) -> list[str] | None:
    """驗證 TOTP 後重新產生 backup codes。"""
    if not user.mfa_enabled or not user.mfa_secret:
        return None
    secret = decrypt_mfa_secret(user.mfa_secret)
    if not secret or not verify_totp_code(secret, code):
        return None
    backup_codes = _generate_backup_codes()
    user.mfa_backup_code_hashes = _hashes_payload(backup_codes)
    await db.flush()
    logger.info("MFA backup codes regenerated", extra={"user_id": str(user.id)})
    return backup_codes


async def disable_mfa(db: AsyncSession, user: User, code: str) -> bool:
    """停用 2FA（需要驗證最後一次 TOTP 碼）"""
    if not user.mfa_enabled:
        return False

    secret = decrypt_mfa_secret(user.mfa_secret)
    if not secret or not verify_totp_code(secret, code):
        return False

    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_pending_secret = None
    user.mfa_backup_code_hashes = {}
    user.mfa_pending_backup_code_hashes = {}

    logger.info("MFA disabled", extra={"user_id": str(user.id)})
    return True
