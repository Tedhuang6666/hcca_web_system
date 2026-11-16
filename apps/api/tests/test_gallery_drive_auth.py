"""相簿 Drive 的服務帳戶唯讀授權。"""

import httpx
import pytest
from google.oauth2 import service_account

from api.core.config import settings
from api.services.gallery_drive import (
    DRIVE_READ_SCOPE,
    DriveReadError,
    GalleryDriveClient,
    gallery_drive_ready,
)


@pytest.mark.asyncio
async def test_gallery_service_account_authorizes_metadata_and_photo_download(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    credential_file = tmp_path / "drive-reader.json"
    credential_file.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE", str(credential_file))

    loaded: dict[str, object] = {}

    class FakeCredentials:
        valid = False
        token: str | None = None

        def refresh(self, request: object) -> None:
            self.valid = True
            self.token = "test-access-token"

    credentials = FakeCredentials()

    class FakeServiceAccountCredentials:
        @classmethod
        def from_service_account_file(cls, filename: str, *, scopes: list[str]) -> FakeCredentials:
            loaded["filename"] = filename
            loaded["scopes"] = scopes
            return credentials

    monkeypatch.setattr(service_account, "Credentials", FakeServiceAccountCredentials)

    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.params.get("alt") == "media":
            return httpx.Response(200, content=b"photo-bytes")
        return httpx.Response(
            200,
            json={
                "files": [
                    {
                        "id": "A" * 20,
                        "name": "photo.jpg",
                        "mimeType": "image/jpeg",
                    }
                ]
            },
        )

    client = GalleryDriveClient()
    await client.client.aclose()
    client.client = httpx.AsyncClient(
        base_url="https://www.googleapis.com/drive/v3/",
        transport=httpx.MockTransport(respond),
    )
    try:
        images = await client.list_images("F" * 20)
        photo = await client.download_image(images[0].id)
    finally:
        await client.client.aclose()

    assert loaded == {"filename": str(credential_file), "scopes": [DRIVE_READ_SCOPE]}
    assert photo == b"photo-bytes"
    assert len(requests) == 2
    assert all(
        request.headers["Authorization"] == "Bearer test-access-token" for request in requests
    )


def test_missing_service_account_file_is_not_hidden_by_legacy_api_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "legacy-test-key")
    monkeypatch.setenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE", str(tmp_path / "missing.json"))

    assert not gallery_drive_ready()
    with pytest.raises(DriveReadError, match="憑證檔案不存在"):
        GalleryDriveClient()


@pytest.mark.asyncio
async def test_gallery_client_uses_existing_api_key_when_no_service_file_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE", raising=False)
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "legacy-test-key")

    client = GalleryDriveClient()
    try:
        assert gallery_drive_ready()
        assert client.client.headers["X-Goog-Api-Key"] == "legacy-test-key"
    finally:
        await client.client.aclose()
