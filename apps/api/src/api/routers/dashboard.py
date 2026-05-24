"""儀表板聚合端點：依角色回傳 widgets。"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.dashboard import DashboardResponse
from api.services.dashboard import build_dashboard

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
