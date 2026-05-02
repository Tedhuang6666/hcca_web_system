"""使用者路由 - /users"""

from fastapi import APIRouter, Depends

from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.schemas.auth import UserRead

router = APIRouter(prefix="/users", tags=["使用者"])


@router.get("/me", response_model=UserRead, summary="取得當前使用者資訊")
async def get_me(current_user: User = Depends(get_current_active_user)) -> User:
    """回傳已驗證的當前使用者完整資訊"""
    return current_user
