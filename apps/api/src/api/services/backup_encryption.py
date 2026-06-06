"""備份檔案 GPG 加密與 sha256 校驗 helper。

不取代既有 [apps/api/src/api/services/backup_tasks.py] 的 pg_dump 與上傳邏輯，
而是補強：
1. 在 pg_dump 後、上傳前對檔案做 GPG 對稱加密
2. 計算加密後檔案的 sha256
3. 寫 BackupRecord 紀錄
4. 提供 verify_backup_file() 給 DR drill 用

GPG 密碼來自 settings.BACKUP_GPG_PASSPHRASE。
未設定時不加密（僅 dev 允許；prod env config validator 應 fail）。
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
from pathlib import Path

from api.core.config import settings

logger = logging.getLogger(__name__)


class BackupEncryptionError(RuntimeError):
    """加密 / 解密 / 校驗失敗的統一例外。"""


def is_encryption_configured() -> bool:
    return bool(settings.BACKUP_GPG_PASSPHRASE)


def gpg_available() -> bool:
    """檢查系統有 gpg 指令可用。"""
    return shutil.which("gpg") is not None


def encrypt_file(
    src_path: Path | str,
    *,
    out_path: Path | str | None = None,
    cleanup_src: bool = True,
) -> Path:
    """對 src_path 做 gpg 對稱加密。

    參數：
        src_path: 原始檔案（pg_dump 輸出）
        out_path: 加密後輸出；None 時自動 append ".gpg"
        cleanup_src: 加密成功後刪除原始檔（避免明文留在磁碟）

    回傳：加密後檔案路徑。

    Raises:
        BackupEncryptionError: GPG 未設密碼、或 gpg 指令不在
    """
    if not is_encryption_configured():
        raise BackupEncryptionError(
            "BACKUP_GPG_PASSPHRASE 未設定，無法加密備份。請於 env 設定或於 dev 環境略過此步驟。"
        )
    if not gpg_available():
        raise BackupEncryptionError(
            "系統找不到 gpg 指令。請安裝：apt install gnupg / brew install gnupg"
        )

    src = Path(src_path)
    if not src.exists():
        raise BackupEncryptionError(f"來源檔案不存在：{src}")

    out = Path(out_path) if out_path else src.with_suffix(src.suffix + ".gpg")

    cmd = [
        "gpg",
        "--batch",
        "--yes",
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--compress-algo",
        "none",  # pg_dump 已可選 -Fc 壓縮、不重複
        "--passphrase-fd",
        "0",
        "--output",
        str(out),
        str(src),
    ]
    try:
        subprocess.run(
            cmd,
            input=settings.BACKUP_GPG_PASSPHRASE.encode("utf-8"),
            check=True,
            capture_output=True,
            timeout=600,
        )
    except subprocess.CalledProcessError as exc:
        # stderr 不含 passphrase（passphrase-fd 走 stdin）
        raise BackupEncryptionError(
            f"gpg 加密失敗（exit={exc.returncode}）：{exc.stderr.decode(errors='replace')}"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise BackupEncryptionError(f"gpg 加密超時：{exc}") from exc

    if not out.exists() or out.stat().st_size == 0:
        raise BackupEncryptionError(f"加密輸出檔案空白：{out}")

    if cleanup_src:
        try:
            src.unlink()
        except OSError:
            logger.warning("無法刪除原始備份檔（明文）：%s", src, exc_info=True)

    return out


def decrypt_file(
    src_path: Path | str,
    *,
    out_path: Path | str | None = None,
) -> Path:
    """解密 gpg 對稱加密檔案。DR drill / 還原時用。"""
    if not is_encryption_configured():
        raise BackupEncryptionError(
            "BACKUP_GPG_PASSPHRASE 未設定，無法解密。請從 1Password 取回密碼後再執行。"
        )
    if not gpg_available():
        raise BackupEncryptionError("系統找不到 gpg 指令。")

    src = Path(src_path)
    if not src.exists():
        raise BackupEncryptionError(f"來源檔案不存在：{src}")

    out = Path(out_path) if out_path else src.with_suffix("")
    if out == src:
        out = src.with_name(src.name + ".decrypted")

    cmd = [
        "gpg",
        "--batch",
        "--yes",
        "--decrypt",
        "--passphrase-fd",
        "0",
        "--output",
        str(out),
        str(src),
    ]
    try:
        subprocess.run(
            cmd,
            input=settings.BACKUP_GPG_PASSPHRASE.encode("utf-8"),
            check=True,
            capture_output=True,
            timeout=600,
        )
    except subprocess.CalledProcessError as exc:
        raise BackupEncryptionError(
            f"gpg 解密失敗（exit={exc.returncode}）：{exc.stderr.decode(errors='replace')}"
        ) from exc

    return out


def compute_sha256(path: Path | str, *, chunk_size: int = 1024 * 1024) -> str:
    """大檔分塊讀 sha256；不一次讀進記憶體。"""
    h = hashlib.sha256()
    p = Path(path)
    with p.open("rb") as fh:
        while chunk := fh.read(chunk_size):
            h.update(chunk)
    return h.hexdigest()


def verify_backup_file(path: Path | str, expected_sha256: str) -> bool:
    """還原前校驗檔案完整性。回傳 True / False、不 raise。"""
    try:
        actual = compute_sha256(path)
    except OSError:
        logger.exception("verify_backup_file: 讀檔失敗 %s", path)
        return False
    if actual.lower() != expected_sha256.lower():
        logger.error(
            "verify_backup_file: sha256 mismatch path=%s expected=%s actual=%s",
            path,
            expected_sha256,
            actual,
        )
        return False
    return True


def file_size_bytes(path: Path | str) -> int:
    return os.stat(path).st_size


__all__ = [
    "BackupEncryptionError",
    "compute_sha256",
    "decrypt_file",
    "encrypt_file",
    "file_size_bytes",
    "gpg_available",
    "is_encryption_configured",
    "verify_backup_file",
]
