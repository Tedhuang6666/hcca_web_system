"""Google Calendar 雙向同步服務層。

架構：
- HCCA 為主要真相來源
- HCCA → Google：事件 create/update/delete 後觸發 push
- Google → HCCA：Celery Beat 每 5 分鐘 pull，以投影（source_module="google_calendar"）呈現
- Loop prevention：HCCA 推出去的事件帶 extendedProperties.private.hcca_event_id，pull 時跳過
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.calendar import (
    CalendarEvent,
    CalendarEventStatus,
    CalendarEventType,
    CalendarVisibility,
)
from api.models.google_calendar import OrgGoogleCalendarConfig

logger = logging.getLogger(__name__)

_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_TAIPEI_TZ = timezone(datetime.now(UTC).astimezone(timezone(datetime.fromtimestamp(0, tz=UTC).astimezone().tzinfo)).utcoffset() or UTC)


class GoogleCalendarAuthError(Exception):
    """Google Calendar OAuth token 失效，需要管理員重新授權。"""


class GoogleCalendarApiError(Exception):
    """Google Calendar API 呼叫失敗。"""


def _build_credentials(config: OrgGoogleCalendarConfig):  # type: ignore[return]
    """從 DB config 建立 google.oauth2.credentials.Credentials 物件。"""
    from google.oauth2.credentials import Credentials

    return Credentials(
        token=config.access_token,
        refresh_token=config.refresh_token,
        token_uri=_TOKEN_URI,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=[_CALENDAR_SCOPE],
    )


def _refresh_credentials_sync(config: OrgGoogleCalendarConfig):  # type: ignore[return]
    """同步刷新 token（Google API 使用 requests 庫）。

    Raises:
        GoogleCalendarAuthError: refresh_token 已失效，需要重新授權
    """
    import google.auth.exceptions
    from google.auth.transport.requests import Request

    creds = _build_credentials(config)
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except google.auth.exceptions.RefreshError as exc:
            raise GoogleCalendarAuthError(
                f"Google token 刷新失敗（{exc}），請管理員重新授權 Google Calendar"
            ) from exc
    return creds


async def get_valid_credentials(session: AsyncSession, config: OrgGoogleCalendarConfig):  # type: ignore[return]
    """取得有效的 Credentials，若已過期則同步刷新並寫回 DB。

    Raises:
        GoogleCalendarAuthError: token 失效需重新授權
    """
    creds = _refresh_credentials_sync(config)
    if creds.token != config.access_token:
        config.access_token = creds.token
        if creds.expiry:
            config.token_expiry = creds.expiry.replace(tzinfo=UTC) if creds.expiry.tzinfo is None else creds.expiry
        await session.flush()
    return creds


def _build_service(creds):  # type: ignore[return]
    """建立 Google Calendar API service 客戶端（同步）。"""
    from googleapiclient.discovery import build

    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def hcca_event_to_google(event: CalendarEvent) -> dict:
    """將 HCCA CalendarEvent 轉換為 Google Calendar API Event 格式。"""
    body: dict = {
        "summary": event.title,
        "description": event.description or "",
        "extendedProperties": {
            "private": {
                "hcca_event_id": str(event.id),
            }
        },
    }

    if event.location:
        body["location"] = event.location

    if event.all_day:
        start_date = event.starts_at.astimezone(timezone.utc).date()
        end_date = (
            event.ends_at.astimezone(timezone.utc).date()
            if event.ends_at
            else start_date
        )
        body["start"] = {"date": start_date.isoformat()}
        body["end"] = {"date": end_date.isoformat()}
    else:
        starts = event.starts_at
        if starts.tzinfo is None:
            starts = starts.replace(tzinfo=UTC)
        body["start"] = {"dateTime": starts.isoformat(), "timeZone": "Asia/Taipei"}
        if event.ends_at:
            ends = event.ends_at
            if ends.tzinfo is None:
                ends = ends.replace(tzinfo=UTC)
            body["end"] = {"dateTime": ends.isoformat(), "timeZone": "Asia/Taipei"}
        else:
            body["end"] = body["start"].copy()

    status_map = {
        CalendarEventStatus.CONFIRMED: "confirmed",
        CalendarEventStatus.DONE: "confirmed",
        CalendarEventStatus.CANCELLED: "cancelled",
        CalendarEventStatus.TENTATIVE: "tentative",
    }
    body["status"] = status_map.get(CalendarEventStatus(event.status), "confirmed")

    return body


async def push_event_to_google(
    session: AsyncSession,
    event: CalendarEvent,
    config: OrgGoogleCalendarConfig,
    *,
    operation: Literal["create", "update", "delete"],
) -> str | None:
    """推送單一事件到 Google Calendar。

    Returns:
        Google event ID（create/update）或 None（delete）
    Raises:
        GoogleCalendarAuthError: token 失效
        GoogleCalendarApiError: API 呼叫失敗
    """
    from googleapiclient.errors import HttpError

    try:
        creds = await get_valid_credentials(session, config)
        service = _build_service(creds)
        calendar_id = config.google_calendar_id or "primary"

        if operation == "delete":
            if not event.google_event_id:
                return None
            try:
                service.events().delete(
                    calendarId=calendar_id, eventId=event.google_event_id
                ).execute()
            except HttpError as exc:
                if exc.resp.status == 404:
                    pass  # 已不存在，視為成功
                else:
                    raise
            return None

        body = hcca_event_to_google(event)

        if operation == "update" and event.google_event_id:
            result = service.events().patch(
                calendarId=calendar_id, eventId=event.google_event_id, body=body
            ).execute()
        else:
            result = service.events().insert(
                calendarId=calendar_id, body=body
            ).execute()

        google_event_id: str = result["id"]
        event.google_event_id = google_event_id
        await session.flush()
        return google_event_id

    except GoogleCalendarAuthError:
        raise
    except Exception as exc:
        raise GoogleCalendarApiError(f"Google Calendar API 呼叫失敗：{exc}") from exc


async def pull_from_google(
    session: AsyncSession,
    config: OrgGoogleCalendarConfig,
) -> dict:
    """從 Google Calendar 增量拉取事件，以投影模式匯入 HCCA。

    使用 syncToken 做增量同步；若 syncToken 過期（HTTP 410）自動 full resync。

    Returns:
        {"created": n, "updated": n, "deleted": n, "errors": n}
    """
    from googleapiclient.errors import HttpError

    from api.models.calendar import CalendarEventStatus, CalendarEventType, CalendarVisibility
    from api.services.coordination import _upsert_projection

    stats = {"created": 0, "updated": 0, "deleted": 0, "errors": 0}

    try:
        creds = await get_valid_credentials(session, config)
        service = _build_service(creds)
        calendar_id = config.google_calendar_id or "primary"

        events_resource = service.events()

        # 決定用 syncToken 增量或重新 full resync
        need_full_sync = config.sync_token is None

        if not need_full_sync:
            try:
                response = events_resource.list(
                    calendarId=calendar_id,
                    syncToken=config.sync_token,
                    singleEvents=True,
                    maxResults=250,
                ).execute()
            except HttpError as exc:
                if exc.resp.status == 410:
                    logger.warning(
                        "[GoogleCalendar] syncToken 過期（org=%s），執行 full resync", config.org_id
                    )
                    need_full_sync = True
                else:
                    raise

        if need_full_sync:
            await _clear_google_projections(session, config)
            response = events_resource.list(
                calendarId=calendar_id,
                singleEvents=True,
                maxResults=250,
                orderBy="updated",
            ).execute()

        all_items: list[dict] = []
        while True:
            all_items.extend(response.get("items", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break
            response = events_resource.list(
                calendarId=calendar_id,
                pageToken=page_token,
                syncToken=None if need_full_sync else config.sync_token,
            ).execute()

        next_sync_token: str | None = response.get("nextSyncToken")

        for item in all_items:
            try:
                await _process_google_event(session, item, config, stats)
            except Exception:
                logger.exception(
                    "[GoogleCalendar] 處理事件失敗（google_event_id=%s）", item.get("id")
                )
                stats["errors"] += 1

        now = datetime.now(UTC)
        config.last_pull_at = now
        config.last_error = None
        if next_sync_token:
            config.sync_token = next_sync_token
            config.sync_token_updated_at = now

        await session.flush()

    except GoogleCalendarAuthError as exc:
        config.last_error = str(exc)[:500]
        await session.flush()
        raise
    except Exception as exc:
        config.last_error = f"同步失敗：{exc}"[:500]
        await session.flush()
        raise

    return stats


async def _process_google_event(
    session: AsyncSession,
    item: dict,
    config: OrgGoogleCalendarConfig,
    stats: dict,
) -> None:
    """處理單一 Google Calendar 事件（upsert 或刪除投影）。"""
    from api.services.coordination import _upsert_projection

    google_event_id: str = item["id"]
    extended = item.get("extendedProperties", {}).get("private", {})

    # Loop prevention：HCCA 推出去的事件，跳過
    if extended.get("hcca_event_id"):
        return

    # 軟刪除：Google 端取消/刪除的事件
    if item.get("status") == "cancelled":
        from sqlalchemy import select

        from api.models.calendar import CalendarEvent

        event = await session.scalar(
            select(CalendarEvent).where(
                CalendarEvent.source_module == "google_calendar",
                CalendarEvent.source_id == config.id,
                CalendarEvent.source_key == google_event_id,
            )
        )
        if event and event.is_active:
            event.is_active = False
            await session.flush()
            stats["deleted"] += 1
        return

    # 解析時間
    start_info = item.get("start", {})
    end_info = item.get("end", {})
    all_day = "date" in start_info and "dateTime" not in start_info

    if all_day:
        from datetime import date

        start_date = date.fromisoformat(start_info["date"])
        starts_at = datetime(start_date.year, start_date.month, start_date.day, tzinfo=UTC)
        if "date" in end_info:
            end_date = date.fromisoformat(end_info["date"])
            ends_at: datetime | None = datetime(end_date.year, end_date.month, end_date.day, tzinfo=UTC)
        else:
            ends_at = None
    else:
        starts_raw = start_info.get("dateTime", "")
        ends_raw = end_info.get("dateTime", "")
        if not starts_raw:
            return
        starts_at = datetime.fromisoformat(starts_raw)
        if starts_at.tzinfo is None:
            starts_at = starts_at.replace(tzinfo=UTC)
        ends_at = datetime.fromisoformat(ends_raw) if ends_raw else None
        if ends_at and ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=UTC)

    created_by_id = config.authorized_by or _get_system_fallback_user_id(session)
    if created_by_id is None:
        return

    title = (item.get("summary") or "（無標題）")[:200]
    description = item.get("description") or None
    location = (item.get("location") or None)
    href = item.get("htmlLink") or None

    was_existing = await _projection_exists(session, config, google_event_id)
    await _upsert_projection(
        session,
        source_module="google_calendar",
        source_id=config.id,
        source_key=google_event_id,
        org_id=config.org_id,
        title=title,
        starts_at=starts_at,
        ends_at=ends_at,
        created_by=created_by_id,
        href=href or f"https://calendar.google.com/calendar/r",
        event_type=CalendarEventType.OTHER,
        status=CalendarEventStatus.CONFIRMED,
        visibility=CalendarVisibility.ORG,
        description=description,
        location=location[:200] if location else None,
    )

    if was_existing:
        stats["updated"] += 1
    else:
        stats["created"] += 1


async def _projection_exists(
    session: AsyncSession, config: OrgGoogleCalendarConfig, google_event_id: str
) -> bool:
    from sqlalchemy import select

    from api.models.calendar import CalendarEvent

    existing = await session.scalar(
        select(CalendarEvent.id).where(
            CalendarEvent.source_module == "google_calendar",
            CalendarEvent.source_id == config.id,
            CalendarEvent.source_key == google_event_id,
        )
    )
    return existing is not None


async def _clear_google_projections(
    session: AsyncSession, config: OrgGoogleCalendarConfig
) -> None:
    """Full resync 前清除此 org 所有 Google Calendar 投影事件（軟刪除）。"""
    from sqlalchemy import update

    from api.models.calendar import CalendarEvent

    await session.execute(
        update(CalendarEvent)
        .where(
            CalendarEvent.source_module == "google_calendar",
            CalendarEvent.source_id == config.id,
            CalendarEvent.is_active.is_(True),
        )
        .values(is_active=False, updated_at=datetime.now(UTC))
    )
    await session.flush()
    config.sync_token = None
    config.sync_token_updated_at = None


async def _get_system_fallback_user_id(session: AsyncSession) -> uuid.UUID | None:
    """取得系統用途的 fallback user ID（最早的超級管理員）。"""
    from sqlalchemy import select

    from api.models.user import User

    result = await session.scalar(
        select(User.id).where(User.is_superuser.is_(True)).order_by(User.created_at).limit(1)
    )
    return result


async def get_config_for_org(
    session: AsyncSession, org_id: uuid.UUID
) -> OrgGoogleCalendarConfig | None:
    """取得某 org 的 Google Calendar 同步設定（需已連結且啟用）。"""
    return await session.scalar(
        select(OrgGoogleCalendarConfig).where(
            OrgGoogleCalendarConfig.org_id == org_id,
            OrgGoogleCalendarConfig.is_active.is_(True),
            OrgGoogleCalendarConfig.sync_enabled.is_(True),
            OrgGoogleCalendarConfig.refresh_token_enc.isnot(None),
        )
    )
