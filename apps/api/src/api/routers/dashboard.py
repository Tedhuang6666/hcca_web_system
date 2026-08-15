"""儀表板聚合端點：依角色回傳 widgets。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.dashboard import DashboardCompositeResponse, DashboardResponse
from api.services.dashboard import build_dashboard, build_dashboard_composite

router = APIRouter(prefix="/dashboard", tags=["儀表板"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get(
    "",
    response_model=DashboardResponse,
    summary="取得當前使用者的儀表板 widgets（角色化）",
)
async def get_dashboard(db: DbDep, user: CurrentUser) -> DashboardResponse:
    """聚合公文、議事、法規、陳情、問卷、公告等模組的待辦/最新項目。"""
    return await build_dashboard(db, user)


@router.get(
    "/composite",
    response_model=DashboardCompositeResponse,
    summary="取得儀表板首屏聚合資料",
)
async def get_dashboard_composite(
    db: DbDep,
    user: CurrentUser,
    include_tasks: bool = Query(True),
    include_matters: bool = Query(True),
    include_announcements: bool = Query(True),
) -> DashboardCompositeResponse:
    """以單次 API 回傳 dashboard、待辦、治理摘要與最新公告。"""
    return await build_dashboard_composite(
        db,
        user,
        include_tasks=include_tasks,
        include_matters=include_matters,
        include_announcements=include_announcements,
    )
