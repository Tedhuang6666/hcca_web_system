"""多來源照片匯入：下載與轉圖在鎖定公開設定前完成。"""

from __future__ import annotations

import asyncio
import copy
import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO

from fastapi import UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import Headers

from api.core.config import settings
from api.models.gallery_sync import GalleryDriveSync
from api.models.site import PublicSiteSettings
from api.models.user import User
from api.schemas.gallery_sync import GalleryDriveConfig, GalleryDriveStatusOut, GallerySyncReportOut
from api.services.gallery_drive import GalleryDriveClient
from api.services.permission import get_user_permission_codes
from api.services.storage import get_storage

MAX_SYNC_IMAGES = 20_000


def next_sync(frequency: str, now: datetime) -> datetime | None:
    seconds = {"quarter_hour": 900, "daily": 86400}.get(frequency)
    return now + timedelta(seconds=seconds) if seconds else None


async def get_source(session: AsyncSession, *, lock: bool = False) -> GalleryDriveSync | None:
    stmt = select(GalleryDriveSync).where(GalleryDriveSync.scope == "gallery")
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(stmt)).scalar_one_or_none()


def status_out(source: GalleryDriveSync | None) -> GalleryDriveStatusOut:
    return GalleryDriveStatusOut(
        config=GalleryDriveConfig.model_validate(source.config if source else {}),
        drive_ready=bool(settings.GOOGLE_DRIVE_API_KEY),
        requested_at=source.requested_at if source else None,
        next_sync_at=source.next_sync_at if source else None,
        last_synced_at=source.last_synced_at if source else None,
        last_report=GallerySyncReportOut.model_validate(source.last_report if source else {}),
    )


async def configure(
    session: AsyncSession, body: GalleryDriveConfig, user_id: uuid.UUID
) -> GalleryDriveSync:
    site = (await session.scalars(select(PublicSiteSettings))).first()
    gallery = (site.homepage_blocks or {}).get("activity_gallery", {}) if site else {}
    albums = {album["id"] for album in gallery.get("events", [])}
    if any(source.album_id not in albums for source in body.sources):
        raise ValueError("請先發布活動，再設定該活動的 Drive 來源")
    source = await get_source(session, lock=True)
    if source is None:
        source = GalleryDriveSync(created_by=user_id, manifest={}, last_report={})
        session.add(source)
    source.config = body.model_dump(mode="json")
    source.manifest = {**source.manifest, "_cursor": {}}
    source.created_by = user_id
    now = datetime.now(UTC)
    source.next_sync_at = next_sync(body.frequency, now)
    # 儲存後自動進行第一次匯入；manual 則等待明確要求。
    source.requested_at = now if body.sources and body.frequency != "manual" else None
    await session.flush()
    return source


def prepare_image(raw: bytes) -> tuple[bytes, int, int]:
    try:
        with Image.open(BytesIO(raw)) as original:
            if original.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("僅支援 JPEG、PNG 與 WebP")
            if original.width * original.height > 40_000_000:
                raise ValueError("照片超過 4000 萬像素")
            image = ImageOps.exif_transpose(original)
            image.thumbnail((2560, 2560))
            # 建立新像素畫布，移除 EXIF、GPS、ICC 與文字 metadata。
            clean = Image.new("RGB", image.size, "white")
            if "A" in image.getbands():
                clean.paste(image.convert("RGB"), mask=image.getchannel("A"))
            else:
                clean.paste(image.convert("RGB"))
            out = BytesIO()
            clean.save(out, format="WEBP", quality=86)
            return out.getvalue(), clean.width, clean.height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("無法解碼照片") from exc


async def synchronize(session: AsyncSession) -> GallerySyncReportOut | None:
    source = (
        await session.execute(
            select(GalleryDriveSync)
            .where(GalleryDriveSync.scope == "gallery")
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    now = datetime.now(UTC)
    if source is None or (
        source.requested_at is None and (source.next_sync_at is None or source.next_sync_at > now)
    ):
        return None
    config = GalleryDriveConfig.model_validate(source.config)
    # 跨批次保留累計結果，不能因最後一批成功而掩蓋前面失敗的照片。
    report = GallerySyncReportOut.model_validate(
        source.last_report if source.manifest.get("_cursor", {}).get("after") else {}
    )
    report.checked_at = now
    manifest = copy.deepcopy(source.manifest)
    prepared: list[tuple[str, dict, dict]] = []
    remaining = False
    try:
        actor = await session.get(User, source.created_by)
        codes = await get_user_permission_codes(session, source.created_by)
        if (
            actor is None
            or not actor.is_active
            or not (actor.is_superuser or {"site:manage", "admin:all"} & set(codes))
        ):
            raise ValueError("設定者已無網站管理權限，請由現任管理員重新儲存設定")
        people = {str(person.email).casefold(): person.name for person in config.photographers}
        candidates = {}
        async with GalleryDriveClient() as drive:
            for folder in config.sources:
                try:
                    files = await drive.list_images(folder.folder_id, folder.recursive)
                except ValueError as exc:
                    report.errors.append(f"資料夾 {folder.folder_id}：{exc}")
                    continue
                for file in files:
                    key = folder.album_id + ":" + file.id
                    # 直接指定的子資料夾優先於遞迴父資料夾。
                    if key not in candidates or file.depth < candidates[key][1].depth:
                        candidates[key] = (folder, file)
                    if len(candidates) > MAX_SYNC_IMAGES:
                        raise ValueError(f"所有來源合計超過 {MAX_SYNC_IMAGES} 張照片，請減少來源")
            downloads = 0
            ordered = list(candidates.items())
            cursor = manifest.get("_cursor", {}).get("after")
            cursor_index = next((i for i, (key, _) in enumerate(ordered) if key == cursor), -1)
            ordered = ordered[cursor_index + 1 :]
            last_attempt = ""
            for key, (folder, file) in ordered:
                names = {people[email] for email in file.owners if email in people}
                credit = next(iter(names)) if len(names) == 1 else folder.photographer
                section = folder.section or file.section
                previous = manifest.get(key, {})
                photo = {
                    "id": "drive-" + uuid.uuid5(uuid.NAMESPACE_URL, key).hex,
                    "photographer": credit,
                    "section": section,
                }
                state = {
                    **previous,
                    "checksum": file.checksum,
                    "photographer": credit,
                    "section": section,
                }
                needs_image = (
                    not previous or not file.checksum or previous.get("checksum") != file.checksum
                )
                if needs_image:
                    if downloads >= 50:
                        remaining = True
                        continue
                    downloads += 1
                    last_attempt = key
                    try:
                        raw = await drive.download_image(file.id)
                        content, width, height = await asyncio.to_thread(prepare_image, raw)
                        upload = UploadFile(
                            BytesIO(content),
                            filename="drive.webp",
                            headers=Headers({"content-type": "image/webp"}),
                        )
                        try:
                            stored = await get_storage().save(upload, prefix="site")
                        finally:
                            await upload.close()
                        photo.update(src=stored.url, width=width, height=height)
                    except ValueError as exc:
                        report.errors.append(f"{file.name[:160]}：{exc}")
                        continue
                prepared.append((key, photo, state))
            # 前一批失敗的照片不會阻塞後續照片；完整巡迴後仍可重試失敗項目。
            manifest["_cursor"] = {"after": last_attempt if remaining else ""}
    except ValueError as exc:
        report.errors.append(str(exc))

    # 取得最新公開資料後合併，保留下載期間的人工修改。
    site = (
        await session.scalars(
            select(PublicSiteSettings)
            .order_by(PublicSiteSettings.created_at)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).first()
    if site:
        blocks = copy.deepcopy(site.homepage_blocks or {})
        gallery = blocks.get("activity_gallery", {})
        albums = {album["id"]: album for album in gallery.get("events", [])}
        for key, photo, state in prepared:
            album_id = key.split(":", 1)[0]
            album = albums.get(album_id)
            if album is None:
                report.errors.append(f"活動 {album_id} 已移除，未匯入照片")
                continue
            photos = album.setdefault("photos", [])
            existing = next((item for item in photos if item.get("id") == photo["id"]), None)
            previous = manifest.get(key, {})
            if existing is None and previous:
                # 人工刪除的相片不會在下一輪自動復活。
                report.unchanged += 1
                continue
            if existing is None:
                photos.append({**photo, "caption": "", "alt": "", "featured": True})
                report.created += 1
                if not photo["photographer"] and not album.get("photographer"):
                    report.unattributed += 1
            else:
                before = existing.copy()
                for field in ("photographer", "section"):
                    if existing.get(field, "") == previous.get(field, ""):
                        existing[field] = photo[field]
                for field in ("src", "width", "height"):
                    if field in photo:
                        existing[field] = photo[field]
                if existing != before:
                    report.updated += 1
                else:
                    report.unchanged += 1
                if not existing.get("photographer") and not album.get("photographer"):
                    report.unattributed += 1
            manifest[key] = state
        site.homepage_blocks = blocks
    elif prepared:
        report.errors.append("找不到公開網站設定")
    source.manifest = manifest
    source.requested_at = now if remaining else None
    source.next_sync_at = (
        now + timedelta(minutes=1) if remaining else next_sync(config.frequency, now)
    )
    if not report.errors and not remaining:
        source.last_synced_at = now
    source.last_report = report.model_dump(mode="json")
    await session.flush()
    return report
