"""附件儲存服務 - StorageBackend 抽象層 + LocalStorage 實作（預留 S3 介面）"""

from __future__ import annotations

import abc
import logging
import mimetypes
import re
import uuid
from pathlib import Path

from fastapi import UploadFile

logger = logging.getLogger(__name__)

# ── 抽象基礎類別 ───────────────────────────────────────────────────────────────


class StorageBackend(abc.ABC):
    """
    儲存後端抽象介面。
    實作此介面可無縫切換 LocalStorage / S3 / GCS 等後端。
    """

    @abc.abstractmethod
    async def save(self, file: UploadFile, prefix: str = "") -> StoredFile:
        """
        儲存上傳的檔案，回傳 StoredFile（含 storage_key）。

        Args:
            file: FastAPI UploadFile 物件
            prefix: 存儲路徑前綴（如 document_id）

        Returns:
            StoredFile 包含 key、url、size 等資訊
        """

    @abc.abstractmethod
    async def delete(self, storage_key: str) -> None:
        """刪除指定 key 的檔案"""

    @abc.abstractmethod
    async def get_url(
        self,
        storage_key: str,
        expires: int = 3600,
        *,
        disposition: str | None = None,
        download_name: str | None = None,
    ) -> str:
        """取得檔案的存取 URL（本地回傳靜態路徑；S3 回傳 presigned URL）。

        disposition / download_name 僅遠端後端使用，用於在 presigned URL 內
        指定 Content-Disposition（inline/attachment 與檔名）；本地後端忽略。
        """

    def local_path(self, storage_key: str) -> Path | None:
        """本地後端回傳實體檔案路徑；遠端後端回傳 None（改用 get_url 重導向）。

        下載/預覽端點以此判斷該直接 serve 本機檔案或重導向到遠端 URL，
        避免將後端類型寫死在路由層。
        """
        return None


class StoredFile:
    """儲存完成後的檔案資訊"""

    __slots__ = ("storage_key", "filename", "content_type", "file_size", "url")

    def __init__(
        self,
        *,
        storage_key: str,
        filename: str,
        content_type: str,
        file_size: int,
        url: str = "",
    ) -> None:
        self.storage_key = storage_key
        self.filename = filename
        self.content_type = content_type
        self.file_size = file_size
        self.url = url


# ── LocalStorage 實作 ──────────────────────────────────────────────────────────

# 允許的 MIME 類型（安全白名單）
_ALLOWED_TYPES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
)

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def _sanitize_filename(filename: str) -> str:
    """移除文件名中 Windows 不允許的字符"""
    # Windows 不允許的字符: < > : " / \ | ? *
    sanitized = re.sub(r'[<>:"/\\|?*]', "_", filename)
    # 移除控制字符
    sanitized = re.sub(r"[\x00-\x1f\x7f]", "", sanitized)
    # 分離名稱和副檔名
    if "." in sanitized:
        parts = sanitized.rsplit(".", 1)
        name, ext = parts[0], parts[1]
        name = name.strip(". ")
        sanitized = f"{name}.{ext}" if name else f"file.{ext}"
    else:
        sanitized = sanitized.strip(". ") or "file"
    return sanitized


class LocalStorageBackend(StorageBackend):
    """
    本地檔案系統儲存後端（開發環境）。
    生產環境請替換為 S3StorageBackend。
    """

    def __init__(self, base_dir: str = "uploads") -> None:
        self._base = Path(base_dir)
        self._base.mkdir(parents=True, exist_ok=True)

    async def save(self, file: UploadFile, prefix: str = "") -> StoredFile:
        """讀取上傳內容、驗證類型與大小、存至本地目錄"""
        # 讀取全部內容（限制大小）
        content = await file.read(MAX_FILE_SIZE + 1)
        if len(content) > MAX_FILE_SIZE:
            msg = f"檔案超過最大限制 {MAX_FILE_SIZE // 1024 // 1024} MB"
            raise ValueError(msg)

        # 偵測 MIME type
        guessed_type, _ = mimetypes.guess_type(file.filename or "")
        content_type = file.content_type or guessed_type or "application/octet-stream"
        if content_type not in _ALLOWED_TYPES:
            msg = f"不支援的檔案類型：{content_type}"
            raise ValueError(msg)

        # 產生唯一 storage_key（使用清理後的副檔名）
        original_filename = file.filename or "file"
        sanitized = _sanitize_filename(original_filename)
        ext = Path(sanitized).suffix or ""
        unique_name = f"{uuid.uuid4().hex}{ext}"
        key = f"{prefix}/{unique_name}".lstrip("/") if prefix else unique_name

        dest = self._base / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)

        logger.info("檔案儲存 key=%s size=%d original_name=%s", key, len(content), sanitized)
        return StoredFile(
            storage_key=key,
            filename=sanitized,
            content_type=content_type,
            file_size=len(content),
            url=f"/uploads/{key}",
        )

    async def delete(self, storage_key: str) -> None:
        target = self._base / storage_key
        if target.exists():
            target.unlink()
            logger.info("檔案刪除 key=%s", storage_key)

    async def get_url(
        self,
        storage_key: str,
        expires: int = 3600,
        *,
        disposition: str | None = None,
        download_name: str | None = None,
    ) -> str:
        return f"/uploads/{storage_key}"

    def local_path(self, storage_key: str) -> Path | None:
        return self._base / storage_key


# ── S3StorageBackend（介面預留）────────────────────────────────────────────────


class S3StorageBackend(StorageBackend):
    """
    AWS S3 / MinIO 相容儲存後端（介面預留，需安裝 boto3）。
    設定方式：在 config.py 加入 S3_BUCKET / AWS_ACCESS_KEY_ID 等環境變數。
    """

    def __init__(self, bucket: str, region: str = "ap-northeast-1") -> None:
        self._bucket = bucket
        self._region = region
        # boto3 延遲載入，避免未安裝時 import 錯誤
        try:
            import boto3  # type: ignore[import-untyped]

            self._client = boto3.client("s3", region_name=region)
        except ImportError as e:
            msg = "請先安裝 boto3：uv add boto3"
            raise RuntimeError(msg) from e

    async def save(self, file: UploadFile, prefix: str = "") -> StoredFile:
        content = await file.read(MAX_FILE_SIZE + 1)
        if len(content) > MAX_FILE_SIZE:
            msg = "檔案超過最大限制"
            raise ValueError(msg)

        original_filename = file.filename or "file"
        sanitized = _sanitize_filename(original_filename)
        ext = Path(sanitized).suffix or ""
        key = f"{prefix}/{uuid.uuid4().hex}{ext}".lstrip("/")
        content_type = file.content_type or "application/octet-stream"

        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        return StoredFile(
            storage_key=key,
            filename=sanitized,
            content_type=content_type,
            file_size=len(content),
            url=await self.get_url(key),
        )

    async def delete(self, storage_key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=storage_key)

    async def get_url(
        self,
        storage_key: str,
        expires: int = 3600,
        *,
        disposition: str | None = None,
        download_name: str | None = None,
    ) -> str:
        params: dict[str, str] = {"Bucket": self._bucket, "Key": storage_key}
        if disposition:
            value = disposition
            if download_name:
                from urllib.parse import quote

                encoded = quote(download_name.encode("utf-8"))
                value = f"{disposition}; filename*=UTF-8''{encoded}"
            params["ResponseContentDisposition"] = value
        return self._client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires,
        )


# ── 全域單例（由 config 決定後端）────────────────────────────────────────────


def get_storage() -> StorageBackend:
    """依 settings.STORAGE_BACKEND 回傳對應的儲存後端（FastAPI 依賴注入用）。"""
    from api.core.config import settings

    backend = (settings.STORAGE_BACKEND or "local").lower()
    if backend == "s3":
        if not settings.S3_BUCKET:
            msg = "STORAGE_BACKEND=s3 時必須設定 S3_BUCKET"
            raise RuntimeError(msg)
        return S3StorageBackend(bucket=settings.S3_BUCKET, region=settings.S3_REGION)
    return LocalStorageBackend(base_dir=settings.STORAGE_LOCAL_DIR)


__all__ = [
    "LocalStorageBackend",
    "S3StorageBackend",
    "StorageBackend",
    "StoredFile",
    "get_storage",
]
