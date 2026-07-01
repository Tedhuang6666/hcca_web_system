"""待辦中心端點：聚合跨模組需要使用者動作的事項。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.task import TaskCountResponse, TaskInboxResponse
from api.services.task_inbox import build_task_inbox_cached, task_count_from_inbox

router = APIRouter(prefix="/tasks", tags=["待辦中心"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get(
    "",
    response_model=TaskInboxResponse,
    summary="取得我的待辦事項（跨模組）",
)
async def get_tasks(db: DbDep, user: CurrentUser) -> TaskInboxResponse:
    return await build_task_inbox_cached(db, user)


@router.get(
    "/count",
    response_model=TaskCountResponse,
    summary="取得我的待辦數量（輕量版）",
)
async def get_task_count(db: DbDep, user: CurrentUser) -> TaskCountResponse:
    inbox = await build_task_inbox_cached(db, user)
    return task_count_from_inbox(inbox)
