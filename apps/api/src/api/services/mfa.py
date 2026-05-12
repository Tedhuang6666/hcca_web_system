"""2FA (TOTP) 服務 - 啟用/停用/驗證多因素認證"""

import logging
import secrets
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from api.models.user import User

logger = logging.getLogger(__name__)


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


async def setup_mfa(db: AsyncSession, user: User) -> dict:
    """
    初始化 2FA 設定，生成待確認的秘鑰

    Returns:
        {"secret": ..., "qr_uri": ..., "backup_codes": [...]}
    """
    secret = generate_totp_secret()
    user.mfa_pending_secret = secret
    # 生成 8 組備用碼（每組 8 字元）
    backup_codes = [secrets.token_hex(4).upper() for _ in range(8)]

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

    if not verify_totp_code(user.mfa_pending_secret, code):
        logger.warning("MFA confirmation failed", extra={"user_id": str(user.id)})
        return False

    user.mfa_secret = user.mfa_pending_secret
    user.mfa_pending_secret = None
    user.mfa_enabled = True

    logger.info("MFA enabled successfully", extra={"user_id": str(user.id)})
    return True


async def verify_mfa(user: User, code: str) -> bool:
    """驗證使用者的 TOTP 碼"""
    if not user.mfa_enabled or not user.mfa_secret:
        return True  # 未啟用 2FA 的用戶直接通過

    return verify_totp_code(user.mfa_secret, code)


async def disable_mfa(db: AsyncSession, user: User, code: str) -> bool:
    """停用 2FA（需要驗證最後一次 TOTP 碼）"""
    if not user.mfa_enabled:
        return False

    if not verify_totp_code(user.mfa_secret, code):
        return False

    user.mfa_enabled = False
    user.mfa_secret = None
    user.mfa_pending_secret = None

    logger.info("MFA disabled", extra={"user_id": str(user.id)})
    return True
