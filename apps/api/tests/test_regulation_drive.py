"""Drive 分頁、資料夾邊界及失敗保護；只替換 HTTP transport。"""

import httpx
import pytest

from api.core.config import settings
from api.services.regulation_drive import (
    DOCX_MIME,
    DriveFile,
    DriveReadError,
    RegulationDriveClient,
)


async def test_drive_lists_all_pages_and_skips_proposals(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    calls = []

    def handle(request):
        calls.append(request)
        token = request.url.params.get("pageToken")
        if "archivedfolder" in request.url.params["q"]:
            return httpx.Response(
                200,
                json={
                    "files": [
                        {"id": "archivedfile1", "name": "舊法.pdf", "mimeType": "application/pdf"}
                    ]
                },
            )
        if token == "next-page":
            return httpx.Response(
                200,
                json={
                    "files": [
                        {
                            "id": "archivedfolder",
                            "name": "已廢止法規",
                            "mimeType": "application/vnd.google-apps.folder",
                        },
                        {
                            "id": "proposalsfolder",
                            "name": "歷年提案",
                            "mimeType": "application/vnd.google-apps.folder",
                        },
                    ]
                },
            )
        return httpx.Response(200, json={"files": [], "nextPageToken": "next-page"})

    async with RegulationDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/", transport=httpx.MockTransport(handle)
        )
        files = await drive.list_files("sourcefolder1")
    assert [file.id for file in files] == ["archivedfile1"]
    assert files[0].repealed
    assert len(calls) == 3
    assert calls[1].url.params["pageToken"] == "next-page"


@pytest.mark.parametrize("payload", [{"incompleteSearch": True}, {"files": []}])
async def test_drive_incomplete_or_empty_listing_is_not_success(monkeypatch, payload):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    async with RegulationDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)),
        )
        with pytest.raises(DriveReadError):
            await drive.list_files("sourcefolder1")


async def test_native_document_uses_docx_export_and_http_errors_hide_keys(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "private-test-key")

    def handle(request):
        assert request.url.path.endswith("/export")
        assert request.url.params["mimeType"] == DOCX_MIME
        return httpx.Response(403, text="private-test-key")

    async with RegulationDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/", transport=httpx.MockTransport(handle)
        )
        with pytest.raises(DriveReadError) as error:
            await drive.download(
                DriveFile("nativefile123", "測試法", "application/vnd.google-apps.document")
            )
    assert "private-test-key" not in str(error.value)
