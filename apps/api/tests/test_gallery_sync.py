"""真實資料庫驗證照片同步、管理權限與公開資料邊界。"""

from datetime import UTC, datetime
from io import BytesIO

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from api.core.config import settings
from api.schemas.gallery_sync import GalleryDriveConfig
from api.services import gallery_drive
from api.services import gallery_sync as sync
from api.services import site as site_svc
from api.services.gallery_drive import DriveImage, GalleryDriveClient
from api.services.regulation_drive import DriveReadError
from api.services.storage import LocalStorageBackend


def image_bytes():
    out = BytesIO()
    image = Image.new("RGB", (100, 60), "red")
    exif = Image.Exif()
    exif[270] = "private camera metadata"
    image.save(out, format="JPEG", exif=exif)
    return out.getvalue()


async def setup_source(db, user, monkeypatch, tmp_path):
    site = await site_svc.get_settings(db)
    site.homepage_blocks = {
        "unrelated": "preserved",
        "activity_gallery": {
            "version": 1,
            "events": [
                {"id": "welcome", "title": "迎新", "summary": "", "sourceUrl": "", "photos": []},
            ],
        },
    }
    await db.flush()
    body = GalleryDriveConfig.model_validate(
        {
            "sources": [
                {"folder_id": "parentfolder1", "album_id": "welcome", "photographer": "父資料夾"},
                {
                    "folder_id": "childfolder12",
                    "album_id": "welcome",
                    "section": "開場",
                    "photographer": "資料夾攝影師",
                },
            ],
            "photographers": [{"email": "photographer@example.com", "name": "攝影甲"}],
            "frequency": "manual",
        }
    )
    source = await sync.configure(db, body, user.id)
    source.requested_at = datetime.now(UTC)
    storage = LocalStorageBackend(str(tmp_path))
    monkeypatch.setattr(sync, "get_storage", lambda: storage)

    class Drive:
        downloads = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def list_images(self, folder, recursive=True):
            depth = 1 if folder == "parentfolder1" else 0
            return [
                DriveImage(
                    "firstphoto12", "first.jpg", "hash1", ("photographer@example.com",), depth, ""
                ),
                DriveImage("secondphoto1", "second.jpg", "hash2", (), depth, ""),
            ]

        async def download_image(self, _):
            Drive.downloads += 1
            return image_bytes()

    monkeypatch.setattr(sync, "GalleryDriveClient", Drive)
    return site, source, Drive


async def test_multifolder_sync_deduplicates_strips_metadata_and_preserves_manual_edits(
    db_session, make_user, monkeypatch, tmp_path
):
    user = await make_user(is_superuser=True)
    site, source, drive = await setup_source(db_session, user, monkeypatch, tmp_path)
    first = await sync.synchronize(db_session)
    assert first.created == 2
    assert drive.downloads == 2
    photos = site.homepage_blocks["activity_gallery"]["events"][0]["photos"]
    assert [photo["photographer"] for photo in photos] == ["攝影甲", "資料夾攝影師"]
    assert {photo["section"] for photo in photos} == {"開場"}
    assert all(photo["caption"] == "" and photo["alt"] == "" for photo in photos)
    assert "example.com" not in str(site.homepage_blocks)
    assert site.homepage_blocks["unrelated"] == "preserved"
    for photo in photos:
        with Image.open(tmp_path / photo["src"].removeprefix("/uploads/")) as image:
            assert not image.getexif()
            assert image.size == (100, 60)
    source.requested_at = datetime.now(UTC)
    again = await sync.synchronize(db_session)
    assert again.unchanged == 2 and drive.downloads == 2
    # 攝影師對應改名會回填既有自動署名；人工署名和描述保留。
    blocks = site.homepage_blocks.copy()
    photos[1].update(photographer="人工指定", caption="人工描述")
    site.homepage_blocks = {
        **blocks,
        "activity_gallery": {
            "version": 1,
            "events": [
                {**blocks["activity_gallery"]["events"][0], "photos": photos},
            ],
        },
    }
    await db_session.flush()
    source.config = {
        **source.config,
        "photographers": [{"email": "photographer@example.com", "name": "攝影甲新名"}],
    }
    source.requested_at = datetime.now(UTC)
    await sync.synchronize(db_session)
    photos = site.homepage_blocks["activity_gallery"]["events"][0]["photos"]
    assert photos[0]["photographer"] == "攝影甲新名"
    assert photos[1]["photographer"] == "人工指定" and photos[1]["caption"] == "人工描述"
    site.homepage_blocks = {
        **site.homepage_blocks,
        "activity_gallery": {
            "version": 1,
            "events": [
                {"id": "welcome", "title": "迎新", "photos": [photos[1]]},
            ],
        },
    }
    await db_session.flush()
    source.requested_at = datetime.now(UTC)
    await sync.synchronize(db_session)
    assert len(site.homepage_blocks["activity_gallery"]["events"][0]["photos"]) == 1


async def test_sync_rechecks_actor_permissions(db_session, make_user, monkeypatch, tmp_path):
    user = await make_user(is_superuser=True)
    site, source, drive = await setup_source(db_session, user, monkeypatch, tmp_path)
    user.is_active = False
    report = await sync.synchronize(db_session)
    assert "管理權限" in report.errors[0]
    assert drive.downloads == 0
    assert not site.homepage_blocks["activity_gallery"]["events"][0]["photos"]
    assert source.last_synced_at is None


async def test_failed_first_batch_does_not_block_later_photos(
    db_session, make_user, monkeypatch, tmp_path
):
    user = await make_user(is_superuser=True)
    site, source, _ = await setup_source(db_session, user, monkeypatch, tmp_path)
    source.config = {
        **source.config,
        "sources": [{**folder, "photographer": ""} for folder in source.config["sources"]],
    }

    class Drive:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def list_images(self, folder, recursive=True):
            return [
                DriveImage(f"batchphoto{i:04d}", f"{i}.jpg", str(i), (), 0, "") for i in range(51)
            ]

        async def download_image(self, file_id):
            if file_id != "batchphoto0050":
                raise ValueError("照片尚未公開")
            return image_bytes()

    monkeypatch.setattr(sync, "GalleryDriveClient", Drive)
    first = await sync.synchronize(db_session)
    assert len(first.errors) == 50 and first.created == 0
    assert source.requested_at is not None
    second = await sync.synchronize(db_session)
    assert second.created == 1
    assert len(second.errors) == 50
    assert second.unattributed == 1
    assert source.last_synced_at is None
    assert source.requested_at is None
    assert len(site.homepage_blocks["activity_gallery"]["events"][0]["photos"]) == 1


async def test_partial_source_failure_keeps_successes_visible(
    db_session, make_user, monkeypatch, tmp_path
):
    user = await make_user(is_superuser=True)
    _, source, drive_class = await setup_source(db_session, user, monkeypatch, tmp_path)
    original = drive_class.list_images

    async def list_images(self, folder, recursive=True):
        if folder == "parentfolder1":
            raise DriveReadError("來源清單不完整")
        return await original(self, folder, recursive)

    monkeypatch.setattr(drive_class, "list_images", list_images)
    report = await sync.synchronize(db_session)
    assert report.created == 2 and len(report.errors) == 1
    assert source.last_synced_at is None


async def test_gallery_routes_enforce_management_and_reject_missing_albums(
    db_session, make_user, authed_client_factory, client, monkeypatch
):
    path = "/site/admin/gallery-drive"
    ordinary = authed_client_factory(await make_user())
    for actor, expected in [(client, 401), (ordinary, 403)]:
        assert (await actor.get(path)).status_code == expected
        assert (await actor.put(path, json={})).status_code == expected
        assert (await actor.post(path + "/run")).status_code == expected
    admin = authed_client_factory(await make_user(is_superuser=True))
    assert (await admin.get(path)).status_code == 200
    assert (
        await admin.put(
            path, json={"sources": [{"folder_id": "abcdefghijk", "album_id": "missing"}]}
        )
    ).status_code == 422
    assert (await admin.put(path, json={"sources": [], "frequency": "manual"})).status_code == 200
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    assert (await admin.post(path + "/run")).status_code == 409
    site = await site_svc.get_settings(db_session)
    site.homepage_blocks = {
        "activity_gallery": {"version": 1, "events": [{"id": "welcome", "photos": []}]}
    }
    await db_session.flush()
    response = await admin.put(
        path,
        json={
            "sources": [{"folder_id": "abcdefghijk", "album_id": "welcome"}],
            "frequency": "quarter_hour",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["requested_at"]
    assert (await admin.post(path + "/run")).status_code == 202


async def test_gallery_drive_walks_pages_and_never_uses_last_modifier(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    calls = []

    def handle(request):
        calls.append(request)
        if "childfolder12" in request.url.params["q"]:
            return httpx.Response(
                200,
                json={
                    "files": [
                        {
                            "id": "samplephoto1",
                            "name": "sample.jpg",
                            "mimeType": "image/jpeg",
                            "md5Checksum": "hash",
                            "owners": [{"emailAddress": "OWNER@EXAMPLE.COM"}],
                            "lastModifyingUser": {"emailAddress": "editor@example.com"},
                        }
                    ]
                },
            )
        if request.url.params.get("pageToken"):
            return httpx.Response(
                200,
                json={
                    "files": [
                        {
                            "id": "childfolder12",
                            "name": "開場",
                            "mimeType": "application/vnd.google-apps.folder",
                        }
                    ]
                },
            )
        return httpx.Response(200, json={"files": [], "nextPageToken": "next"})

    async with GalleryDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/", transport=httpx.MockTransport(handle)
        )
        photos = await drive.list_images("parentfolder1")
    assert len(calls) == 3
    assert photos[0].owners == ("owner@example.com",)
    assert photos[0].section == "開場" and photos[0].depth == 1


@pytest.mark.parametrize(
    "payload",
    [
        {"files": [], "incompleteSearch": True},
        {"files": [], "nextPageToken": "loop"},
        {"files": [{"id": "bad' ID", "name": "bad.jpg", "mimeType": "image/jpeg"}]},
    ],
)
async def test_gallery_drive_rejects_incomplete_or_invalid_listings(payload, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    async with GalleryDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)),
        )
        with pytest.raises(DriveReadError):
            await drive.list_images("parentfolder1")


def test_gallery_config_rejects_duplicate_email_and_invalid_folder():
    for body in [
        {"photographers": [{"email": 42, "name": "甲"}]},
        {
            "photographers": [
                {"email": "a@example.com", "name": "甲"},
                {"email": "A@example.com", "name": "乙"},
            ]
        },
        {"sources": [{"album_id": "welcome", "folder_id": "https://evil.example/folder"}]},
    ]:
        with pytest.raises(ValidationError):
            GalleryDriveConfig.model_validate(body)


async def test_gallery_drive_reads_thousands_of_images_across_pages(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    pages = []

    def handle(request):
        offset = int(request.url.params.get("pageToken", "0"))
        pages.append(offset)
        end = min(offset + 1000, 3079)
        payload = {
            "files": [
                {"id": f"largephoto{i:05d}", "name": f"{i:05d}.jpg", "mimeType": "image/jpeg"}
                for i in range(offset, end)
            ]
        }
        if end < 3079:
            payload["nextPageToken"] = str(end)
        return httpx.Response(200, json=payload)

    async with GalleryDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/", transport=httpx.MockTransport(handle)
        )
        photos = await drive.list_images("parentfolder1")
    assert pages == [0, 1000, 2000, 3000]
    assert len(photos) == 3079
    assert len({photo.id for photo in photos}) == 3079


@pytest.mark.parametrize(
    ("mime_type", "message"),
    [
        ("image/jpeg", "來源指向單一檔案"),
        ("application/vnd.google-apps.folder", "沒有可匯入"),
    ],
)
async def test_gallery_drive_reports_empty_or_nonfolder_sources(monkeypatch, mime_type, message):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")

    def handle(request):
        payload = {"files": []} if request.url.path.endswith("/files") else {"mimeType": mime_type}
        return httpx.Response(200, json=payload)

    async with GalleryDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/", transport=httpx.MockTransport(handle)
        )
        with pytest.raises(DriveReadError, match=message):
            await drive.list_images("parentfolder1")


async def test_gallery_drive_keeps_capacity_errors_visible(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_DRIVE_API_KEY", "test-key")
    monkeypatch.setattr(gallery_drive, "MAX_SOURCE_IMAGES", 2)
    payload = {
        "files": [
            {"id": f"largephoto{i:05d}", "name": f"{i}.jpg", "mimeType": "image/jpeg"}
            for i in range(3)
        ]
    }
    async with GalleryDriveClient() as drive:
        await drive.client.aclose()
        drive.client = httpx.AsyncClient(
            base_url="https://www.googleapis.com/drive/v3/",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)),
        )
        with pytest.raises(DriveReadError, match="單一來源超過 2 張照片"):
            await drive.list_images("parentfolder1")


async def test_gallery_sync_imports_thousands_in_resumable_batches(
    db_session, make_user, monkeypatch, tmp_path
):
    user = await make_user(is_superuser=True)
    site, source, _ = await setup_source(db_session, user, monkeypatch, tmp_path)
    raw = image_bytes()

    class Drive:
        downloads = 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def list_images(self, folder, recursive=True):
            return [
                DriveImage(f"largephoto{i:05d}", f"{i:05d}.jpg", str(i), (), 0, "")
                for i in range(3079)
            ]

        async def download_image(self, _):
            Drive.downloads += 1
            return raw

    monkeypatch.setattr(sync, "GalleryDriveClient", Drive)
    for batch in range(62):
        report = await sync.synchronize(db_session)
        assert report is not None and not report.errors
        assert report.created == min((batch + 1) * 50, 3079)
        assert Drive.downloads == report.created
    assert source.requested_at is None
    assert source.last_synced_at is not None
    photos = site.homepage_blocks["activity_gallery"]["events"][0]["photos"]
    assert len(photos) == len({photo["id"] for photo in photos}) == 3079
    source.requested_at = datetime.now(UTC)
    again = await sync.synchronize(db_session)
    assert again.created == 0 and again.unchanged == 3079 and not again.errors
    assert Drive.downloads == 3079
