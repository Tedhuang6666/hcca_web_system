"""將已授權的儲存檔案轉為 HTTP 回應。

領域入口先完成歸屬／公開性檢查，再指定檔名、顯示方式與快取 headers。
儲存後端仍只負責檔案與 URL，不承擔 HTTP 或領域授權。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Literal
from urllib.parse import quote, urlsplit

from fastapi import HTTPException, status
from fastapi.responses import FileResponse, RedirectResponse

from api.core.config import settings
from api.services.storage import StorageBackend

logger = logging.getLogger(__name__)
FileDisposition = Literal["inline", "attachment"]


def presigned_storage_redirect(
    url: str, *, headers: Mapping[str, str] | None = None
) -> RedirectResponse:
    """只接受目前 S3 bucket／region 的 HTTPS 預簽網址。"""
    region = settings.S3_REGION
    bucket = settings.S3_BUCKET
    allowed_hosts = {
        f"{bucket}.s3.{region}.amazonaws.com",
        f"s3.{region}.amazonaws.com",
    }
    if region == "us-east-1":
        allowed_hosts.update({f"{bucket}.s3.amazonaws.com", "s3.amazonaws.com"})
    try:
        parsed = urlsplit(url)
        trusted = (
            parsed.scheme == "https"
            and parsed.hostname in allowed_hosts
            and parsed.username is None
            and parsed.password is None
            and parsed.port in {None, 443}
        )
    except ValueError:
        trusted = False
    if not trusted:
        # 不記錄完整 URL，以免將短效存取憑證寫入日誌。
        logger.error("Rejected untrusted presigned storage URL")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="無效的檔案儲存網址")
    return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT, headers=headers)


async def deliver_stored_file(
    storage: StorageBackend,
    storage_key: str,
    *,
    content_type: str | None = None,
    filename: str | None = None,
    disposition: FileDisposition = "inline",
    headers: Mapping[str, str] | None = None,
    local_headers: Mapping[str, str] | None = None,
    missing_detail: str = "檔案不存在",
) -> FileResponse | RedirectResponse:
    """提供本機檔案或安全重導向；headers 策略由已授權的領域入口決定。

    headers 同時套用本機與重導向；local_headers 供僅本機檔案適用的快取策略，
    避免把可長期快取的檔案規則套用到短效預簽 URL 的重導向回應。
    """
    local_path = storage.local_path(storage_key)
    if local_path is not None:
        if not local_path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=missing_detail)
        response_headers = {**(headers or {}), **(local_headers or {})}
        if filename:
            encoded_name = quote(filename, safe="")
            response_headers["Content-Disposition"] = (
                f"{disposition}; filename*=UTF-8''{encoded_name}"
            )
        return FileResponse(
            local_path,
            media_type=content_type,
            filename=filename,
            content_disposition_type=disposition,
            headers=response_headers,
        )
    url = await storage.get_url(storage_key, disposition=disposition, download_name=filename)
    return presigned_storage_redirect(url, headers=headers)
