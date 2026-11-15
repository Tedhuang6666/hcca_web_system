"""公開 Drive 相片讀取；只接受固定 Google API 路徑。"""

from dataclasses import dataclass

import httpx

from api.services.regulation_drive import _ID_RE, DriveReadError, RegulationDriveClient

IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
MAX_IMAGE_BYTES = 30 * 1024 * 1024
MAX_SOURCE_IMAGES = 10_000


@dataclass(frozen=True)
class DriveImage:
    id: str
    name: str
    checksum: str
    owners: tuple[str, ...]
    depth: int
    section: str


class GalleryDriveClient(RegulationDriveClient):
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
                    response = await self.client.get("files", params=params)
                    response.raise_for_status()
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
                        "無法完整讀取照片來源，請檢查資料夾分享權限與 API 金鑰"
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
                )
                response.raise_for_status()
                mime_type = response.json()["mimeType"]
            except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
                raise DriveReadError("無法確認來源資料夾，請檢查資料夾分享權限與 API 金鑰") from exc
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
            async with self.client.stream(
                "GET", f"files/{file_id}", params={"alt": "media", "supportsAllDrives": "true"}
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_IMAGE_BYTES:
                        raise DriveReadError("照片超過 30 MB")
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise DriveReadError("無法下載照片，請確認照片可公開讀取") from exc
        return b"".join(chunks)
