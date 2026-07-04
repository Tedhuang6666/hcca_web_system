"""Google Tasks 雙向同步服務層。

架構：
- HCCA WorkItem 為主要真相來源
- HCCA → Google Tasks：WorkItem create/update/complete 後觸發 push
- Google Tasks → HCCA：手動觸發或定期 pull（僅建立新 task，不覆寫現有）
- Loop prevention：HCCA 推出去的 task notes 帶 [hcca_id:<uuid>] 標記，pull 時跳過
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.models.user_google_tasks import UserGoogleTasksConfig
from api.models.work_item import WorkItem, WorkItemStatus

logger = logging.getLogger(__name__)

_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks"
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_TASKLIST_NAME = "HCCA 工作"
_HCCA_MARKER = "[hcca_managed]"


class GoogleTasksAuthError(Exception):
    """Google Tasks OAuth token 失效，需要使用者重新授權。"""


class GoogleTasksApiError(Exception):
    """Google Tasks API 呼叫失敗。"""


def _build_credentials(config: UserGoogleTasksConfig):
    from google.oauth2.credentials import Credentials

    return Credentials(
        token=config.access_token,
        refresh_token=config.refresh_token,
        token_uri=_TOKEN_URI,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=[_TASKS_SCOPE],
    )


def _refresh_credentials_sync(config: UserGoogleTasksConfig):
    import google.auth.exceptions
    from google.auth.transport.requests import Request

    creds = _build_credentials(config)
    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except google.auth.exceptions.RefreshError as exc:
            raise GoogleTasksAuthError(
                f"Google Tasks token 刷新失敗（{exc}），請重新授權"
            ) from exc
    return creds


async def get_valid_credentials(session: AsyncSession, config: UserGoogleTasksConfig):
    """取得有效的 Credentials，若已過期則同步刷新並寫回 DB。"""
    creds = _refresh_credentials_sync(config)
    if creds.token != config.access_token:
        config.access_token = creds.token
        if creds.expiry:
            config.token_expiry = (
                creds.expiry.replace(tzinfo=UTC) if creds.expiry.tzinfo is None else creds.expiry
            )
        await session.flush()
    return creds


def _build_service(creds):
    from googleapiclient.discovery import build

    return build("tasks", "v1", credentials=creds, cache_discovery=False)


async def ensure_tasklist(session: AsyncSession, config: UserGoogleTasksConfig) -> str:
    """確保 HCCA 專屬 tasklist 存在，回傳 tasklist ID。"""
    if config.google_tasklist_id:
        return config.google_tasklist_id

    try:
        creds = await get_valid_credentials(session, config)
        service = _build_service(creds)

        result = service.tasklists().list(maxResults=100).execute()
        for tl in result.get("items", []):
            if tl.get("title") == _TASKLIST_NAME:
                config.google_tasklist_id = tl["id"]
                await session.flush()
                return tl["id"]

        created = service.tasklists().insert(body={"title": _TASKLIST_NAME}).execute()
        config.google_tasklist_id = created["id"]
        await session.flush()
        return created["id"]
    except GoogleTasksAuthError:
        raise
    except Exception as exc:
        raise GoogleTasksApiError(f"建立 tasklist 失敗：{exc}") from exc


def _work_item_to_google_task(item: WorkItem) -> dict:
    body: dict = {
        "title": item.title,
        "notes": f"{_HCCA_MARKER}\n{item.description or ''}".strip(),
    }
    if item.due_at:
        due_utc = item.due_at.astimezone(UTC) if item.due_at.tzinfo else item.due_at.replace(tzinfo=UTC)
        body["due"] = due_utc.strftime("%Y-%m-%dT00:00:00.000Z")
    if item.status == WorkItemStatus.DONE:
        body["status"] = "completed"
        if item.completed_at:
            completed = (
                item.completed_at.astimezone(UTC)
                if item.completed_at.tzinfo
                else item.completed_at.replace(tzinfo=UTC)
            )
            body["completed"] = completed.isoformat()
    else:
        body["status"] = "needsAction"
    return body


async def push_work_item(
    session: AsyncSession,
    item: WorkItem,
    config: UserGoogleTasksConfig,
) -> str | None:
    """推送單一 WorkItem 到 Google Tasks（create 或 update）。

    Returns:
        Google task ID 或 None（失敗但不中斷主流程）
    """
    from googleapiclient.errors import HttpError

    try:
        creds = await get_valid_credentials(session, config)
        service = _build_service(creds)
        tasklist_id = await ensure_tasklist(session, config)
        body = _work_item_to_google_task(item)

        if item.google_task_id:
            try:
                result = service.tasks().patch(
                    tasklist=tasklist_id, task=item.google_task_id, body=body
                ).execute()
                return result["id"]
            except HttpError as exc:
                if exc.resp.status == 404:
                    item.google_task_id = None
                else:
                    raise

        result = service.tasks().insert(tasklist=tasklist_id, body=body).execute()
        item.google_task_id = result["id"]
        await session.flush()
        return result["id"]

    except GoogleTasksAuthError:
        raise
    except Exception as exc:
        logger.warning("[GoogleTasks] push 失敗（item=%s）：%s", item.id, exc)
        return None


async def delete_google_task(
    session: AsyncSession,
    item: WorkItem,
    config: UserGoogleTasksConfig,
) -> None:
    """刪除 Google Tasks 上對應的 task。"""
    if not item.google_task_id:
        return
    from googleapiclient.errors import HttpError

    try:
        creds = await get_valid_credentials(session, config)
        service = _build_service(creds)
        tasklist_id = config.google_tasklist_id or await ensure_tasklist(session, config)
        service.tasks().delete(tasklist=tasklist_id, task=item.google_task_id).execute()
        item.google_task_id = None
        await session.flush()
    except HttpError as exc:
        if exc.resp.status != 404:
            logger.warning("[GoogleTasks] delete 失敗（task=%s）：%s", item.google_task_id, exc)
    except Exception as exc:
        logger.warning("[GoogleTasks] delete 失敗（task=%s）：%s", item.google_task_id, exc)


async def pull_from_google(
    session: AsyncSession,
    config: UserGoogleTasksConfig,
    user_id: uuid.UUID,
) -> dict:
    """從 Google Tasks 拉取非 HCCA 管理的 task，建立為 WorkItem。

    Returns:
        {"created": n, "skipped": n, "errors": n}
    """
    stats = {"created": 0, "skipped": 0, "errors": 0}

    try:
        creds = await get_valid_credentials(session, config)
        service = _build_service(creds)
        tasklist_id = await ensure_tasklist(session, config)

        result = service.tasks().list(
            tasklist=tasklist_id,
            showCompleted=False,
            maxResults=100,
        ).execute()
        tasks = result.get("items", [])

        existing_task_ids: set[str] = set(
            (
                await session.scalars(
                    select(WorkItem.google_task_id).where(
                        WorkItem.google_task_id.isnot(None),
                        WorkItem.assigned_to_id == user_id,
                        WorkItem.is_active.is_(True),
                    )
                )
            ).all()
        )

        from api.schemas.work_item import WorkItemCreate
        from api.services import work_item as work_item_svc

        for task in tasks:
            task_id: str = task["id"]
            notes: str = task.get("notes") or ""

            if _HCCA_MARKER in notes:
                stats["skipped"] += 1
                continue
            if task_id in existing_task_ids:
                stats["skipped"] += 1
                continue

            try:
                title = (task.get("title") or "（無標題）")[:200]
                due_str: str | None = task.get("due")
                due_at = datetime.fromisoformat(due_str.replace("Z", "+00:00")) if due_str else None

                new_item = await work_item_svc.create_work_item(
                    session,
                    data=WorkItemCreate(
                        title=title,
                        description=notes[:5000] if notes else None,
                        assigned_to_id=user_id,
                        due_at=due_at,
                    ),
                    created_by_id=user_id,
                )
                new_item.google_task_id = task_id
                await session.flush()
                stats["created"] += 1
            except Exception:
                logger.exception("[GoogleTasks] pull 建立 WorkItem 失敗（task=%s）", task_id)
                stats["errors"] += 1

        config.last_sync_at = datetime.now(UTC)
        config.last_error = None
        await session.flush()

    except GoogleTasksAuthError as exc:
        config.last_error = str(exc)[:500]
        await session.flush()
        raise
    except Exception as exc:
        config.last_error = f"同步失敗：{exc}"[:500]
        await session.flush()
        raise GoogleTasksApiError(str(exc)) from exc

    return stats


async def get_config_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> UserGoogleTasksConfig | None:
    """取得使用者的 Google Tasks 設定（需已連結且啟用）。"""
    return await session.scalar(
        select(UserGoogleTasksConfig).where(
            UserGoogleTasksConfig.user_id == user_id,
            UserGoogleTasksConfig.is_active.is_(True),
            UserGoogleTasksConfig.sync_enabled.is_(True),
        )
    )
