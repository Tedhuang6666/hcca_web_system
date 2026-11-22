"""以唯讀 Drive API 取得完整資料夾樹；不使用使用者瀏覽器的登入憑證。"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from api.core.config import settings

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MAX_FILE_BYTES = 10 * 1024 * 1024
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,200}$")


class DriveReadError(ValueError):
    pass


@dataclass(frozen=True)
class DriveFile:
    id: str
    name: str
    mime_type: str
    repealed: bool = False


class RegulationDriveClient:
    def __init__(self) -> None:
        if not settings.GOOGLE_DRIVE_API_KEY:
            raise DriveReadError(
                "尚未設定 GOOGLE_DRIVE_API_KEY，請由管理員設定唯讀公開資料存取金鑰"
            )
        self.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/",
            headers={"X-Goog-Api-Key": settings.GOOGLE_DRIVE_API_KEY},
            timeout=30,
            follow_redirects=False,
        )

    async def __aenter__(self) -> RegulationDriveClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.client.aclose()

    async def list_files(self, folder_id: str) -> list[DriveFile]:
        folders = [(folder_id, False)]
        visited: set[str] = set()
        files: dict[str, DriveFile] = {}
        while folders:
            current, repealed = folders.pop()
            if current in visited:
                continue
            if not _ID_RE.fullmatch(current) or len(visited) >= 100:
                raise DriveReadError("來源資料夾樹格式錯誤或超過 100 個資料夾")
            visited.add(current)
            page_token = ""
            tokens: set[str] = set()
            while True:
                params = {
                    "q": f"'{current}' in parents and trashed = false",
                    "fields": "nextPageToken,incompleteSearch,files(id,name,mimeType)",
                    "pageSize": "1000",
                    "supportsAllDrives": "true",
                    "includeItemsFromAllDrives": "true",
                }
                if page_token:
                    params["pageToken"] = page_token
                try:
                    response = await self.client.get("files", params=params)
                    response.raise_for_status()
                    payload = response.json()
                except (httpx.HTTPError, ValueError) as exc:
                    raise DriveReadError(
                        "無法列出 Drive 檔案，請檢查資料夾分享設定及 API 金鑰"
                    ) from exc
                if payload.get("incompleteSearch"):
                    raise DriveReadError("Drive 回報檔案清單不完整，本次不更新法規")
                for entry in payload.get("files", []):
                    file_id, name, mime = entry["id"], entry["name"], entry["mimeType"]
                    if not _ID_RE.fullmatch(file_id):
                        raise DriveReadError("Drive 回傳無效檔案 ID")
                    if mime == "application/vnd.google-apps.folder":
                        if "提案" not in name:
                            folders.append((file_id, repealed or "廢止" in name))
                    elif mime in {
                        "application/pdf",
                        DOCX_MIME,
                        "application/vnd.google-apps.document",
                    } and not name.lstrip().startswith(("~$", "!!")):
                        files[file_id] = DriveFile(file_id, name, mime, repealed)
                    if len(files) > 500:
                        raise DriveReadError("來源超過 500 份文件，本次不更新法規")
                page_token = payload.get("nextPageToken", "")
                if not page_token:
                    break
                if page_token in tokens:
                    raise DriveReadError("Drive 分頁重複，本次不更新法規")
                tokens.add(page_token)
        if not files:
            raise DriveReadError("來源沒有可同步的 Word/PDF 法規，請檢查資料夾及分享權限")
        return sorted(files.values(), key=lambda item: item.name)

    async def download(self, file: DriveFile) -> tuple[bytes, str]:
        if not _ID_RE.fullmatch(file.id):
            raise DriveReadError("無效檔案 ID")
        native = file.mime_type == "application/vnd.google-apps.document"
        path = f"files/{file.id}/export" if native else f"files/{file.id}"
        params = (
            {"mimeType": DOCX_MIME} if native else {"alt": "media", "supportsAllDrives": "true"}
        )
        chunks: list[bytes] = []
        size = 0
        try:
            async with self.client.stream("GET", path, params=params) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_FILE_BYTES:
                        raise DriveReadError("檔案超過 10 MB，未更新此法規")
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise DriveReadError("無法下載檔案，請確認檔案可公開讀取") from exc
        suffix = ".docx" if native or file.mime_type == DOCX_MIME else ".pdf"
        return b"".join(chunks), file.name if file.name.lower().endswith(
            suffix
        ) else file.name + suffix
