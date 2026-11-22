"""Google Drive 相片讀取；只接受固定 Google API 路徑。"""

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path

import httpx
from google.auth.credentials import Credentials
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import service_account

from api.core.config import settings
from api.services.regulation_drive import _ID_RE, DriveReadError, RegulationDriveClient

IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_SOURCE_IMAGES = 10_000
DRIVE_READ_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
SERVICE_ACCOUNT_ENV = "GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE"


class DriveRetryLater(DriveReadError):
    """Google 暫時封鎖或限流，應保留游標並延後重試。"""


def gallery_drive_ready() -> bool:
    """回報相簿 Drive 憑證是否可供背景工作使用。"""
    credential_file = os.environ.get(SERVICE_ACCOUNT_ENV, "").strip()
    if credential_file:
        return Path(credential_file).is_file() and os.access(credential_file, os.R_OK)
    return bool(settings.GOOGLE_DRIVE_API_KEY)


async def _check_drive_response(response: httpx.Response) -> None:
    if response.is_success:
        return
    if response.status_code in {429, 500, 502, 503, 504}:
        raise DriveRetryLater("Google 暫時限制照片存取，已保留匯入進度")
    if response.status_code == 403:
        sample = bytearray()
        async for chunk in response.aiter_bytes():
            sample.extend(chunk[: 8192 - len(sample)])
            if len(sample) >= 8192:
                break
        reasons = set()
        try:
            error = json.loads(sample).get("error", {})
            reasons = {
                item.get("reason")
                for item in error.get("errors", []) + error.get("details", [])
                if isinstance(item, dict)
            }
        except (ValueError, AttributeError, TypeError):
            pass
        if b"automated queries" in sample.lower() or reasons & {
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "RATE_LIMIT_EXCEEDED",
        }:
            raise DriveRetryLater("Google 暫時限制照片存取，已保留匯入進度")
    response.raise_for_status()


@dataclass(frozen=True)
class DriveImage:
    id: str
    name: str
    checksum: str
    owners: tuple[str, ...]
    depth: int
    section: str


class GalleryDriveClient(RegulationDriveClient):
    def __init__(self) -> None:
        credential_file = os.environ.get(SERVICE_ACCOUNT_ENV, "").strip()
        self._service_account_credentials: Credentials | None = None
        self._credential_lock: asyncio.Lock | None = None
        if not credential_file:
            super().__init__()
            return
        if not gallery_drive_ready():
            raise DriveReadError("Google Drive 服務帳戶憑證檔案不存在或無法讀取")
        try:
            self._service_account_credentials = (
                service_account.Credentials.from_service_account_file(
                    credential_file,
                    scopes=[DRIVE_READ_SCOPE],
                )
            )
        except (OSError, GoogleAuthError, ValueError, TypeError, KeyError) as exc:
            raise DriveReadError(
                "無法讀取 Google Drive 服務帳戶憑證，請檢查唯讀 JSON 檔案"
            ) from exc
        self._credential_lock = asyncio.Lock()
        self.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/",
            timeout=30,
            follow_redirects=False,
        )

    async def _authorization_headers(self) -> dict[str, str]:
        credentials = self._service_account_credentials
        if credentials is None:
            return {}
        lock = self._credential_lock
        if lock is None:
            raise DriveReadError("Google Drive 服務帳戶授權未初始化")
        try:
            async with lock:
                if not credentials.valid:
                    await asyncio.to_thread(credentials.refresh, Request())
                token = credentials.token
        except Exception as exc:
            raise DriveRetryLater("Google Drive 授權暫時失敗，已保留匯入進度") from exc
        if not token:
            raise DriveRetryLater("Google Drive 授權暫時失敗，已保留匯入進度")
        return {"Authorization": f"Bearer {token}"}

    async def list_images(self, folder_id: str, recursive: bool = True) -> list[DriveImage]:
        folders = [(folder_id, 0, "")]
        visited: set[str] = set()
        files: dict[str, DriveImage] = {}
        while folders:
            current, depth, section = folders.pop()
            if current in visited:
                continue
            if not _ID_RE.fullmatch(current) or len(visited) >= 100:
                raise DriveReadError("資料夾 ID 無效或來源超過 100 個子資料夾")
            visited.add(current)
            page_token = ""
            tokens: set[str] = set()
            while True:
                params = {
                    "q": f"'{current}' in parents and trashed = false",
                    "fields": "nextPageToken,incompleteSearch,files(id,name,mimeType,"
                    "md5Checksum,owners(emailAddress))",
                    "pageSize": "1000",
                    "supportsAllDrives": "true",
                    "includeItemsFromAllDrives": "true",
                }
                if page_token:
                    params["pageToken"] = page_token
                try:
                    response = await self.client.get(
                        "files", params=params, headers=await self._authorization_headers()
                    )
                    await _check_drive_response(response)
                    payload = response.json()
                    if payload.get("incompleteSearch"):
                        raise DriveReadError("Drive 檔案清單不完整，未匯入此來源")
                    for entry in payload["files"]:
                        file_id, name = entry["id"], entry["name"]
                        if not _ID_RE.fullmatch(file_id):
                            raise DriveReadError("Drive 回傳無效檔案 ID")
                        if entry["mimeType"] == "application/vnd.google-apps.folder":
                            if recursive:
                                folders.append(
                                    (file_id, depth + 1, (section + "/" + name).strip("/")[:120])
                                )
                        elif entry["mimeType"] in IMAGE_TYPES:
                            files[file_id] = DriveImage(
                                file_id,
                                name,
                                entry.get("md5Checksum", ""),
                                tuple(
                                    owner["emailAddress"].strip().casefold()
                                    for owner in entry.get("owners", [])
                                    if owner.get("emailAddress")
                                ),
                                depth,
                                section,
                            )
                        if len(files) > MAX_SOURCE_IMAGES:
                            raise DriveReadError(
                                f"單一來源超過 {MAX_SOURCE_IMAGES} 張照片，請拆成較小的來源資料夾"
                            )
                    page_token = payload.get("nextPageToken", "")
                except DriveReadError:
                    raise
                except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                    raise DriveReadError(
                        "無法完整讀取照片來源，請檢查資料夾分享權限與 Google Drive 憑證"
                    ) from exc
                if not page_token:
                    break
                if page_token in tokens:
                    raise DriveReadError("Drive 分頁重複，未匯入此來源")
                tokens.add(page_token)
        if not files:
            try:
                response = await self.client.get(
                    f"files/{folder_id}",
                    params={"fields": "mimeType", "supportsAllDrives": "true"},
                    headers=await self._authorization_headers(),
                )
                await _check_drive_response(response)
                mime_type = response.json()["mimeType"]
            except DriveReadError:
                raise
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                raise DriveReadError("無法確認來源資料夾，請檢查資料夾分享權限與唯讀授權") from exc
            if mime_type != "application/vnd.google-apps.folder":
                raise DriveReadError("來源指向單一檔案，請改用包含照片的 Google Drive 資料夾連結")
            raise DriveReadError(
                "來源資料夾沒有可匯入的 JPEG、PNG 或 WebP 照片，請檢查子資料夾與分享權限"
            )
        return sorted(files.values(), key=lambda file: (file.name, file.id))

    async def download_image(self, file_id: str) -> bytes:
        if not _ID_RE.fullmatch(file_id):
            raise DriveReadError("無效檔案 ID")
        chunks: list[bytes] = []
        size = 0
        try:
            headers = await self._authorization_headers()
            async with self.client.stream(
                "GET",
                f"files/{file_id}",
                params={"alt": "media", "supportsAllDrives": "true"},
                headers=headers,
            ) as response:
                await _check_drive_response(response)
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_IMAGE_BYTES:
                        raise DriveReadError("照片超過 30 MB")
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise DriveReadError("無法下載照片，請確認唯讀授權具有照片檢視權限") from exc
        return b"".join(chunks)
