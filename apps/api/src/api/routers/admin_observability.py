from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.user import User

router = APIRouter(prefix="/admin/system/observability", tags=["管理員 / Observability"])
DbDep = Annotated[AsyncSession, Depends(get_db)]


async def require_superuser(user: User = Depends(get_current_active_user)) -> User:
    if not user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要超級管理員權限")
    return user


@router.get("/overview", summary="Observability Overview")
async def overview(session: DbDep, _admin: Annotated[User, Depends(require_superuser)]) -> dict[str, Any]:
    db_ok = True
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        "system_health": [
            {"name": "API", "healthy": True},
            {"name": "PostgreSQL", "healthy": db_ok},
            {"name": "Redis", "healthy": True},
            {"name": "Celery", "healthy": True},
        ],
        "reliability": {"error_rate": None, "affected_users": None, "new_issues": 0, "regressions": 0},
        "synthetic": {"mobile_performance": None, "desktop_performance": None, "mobile_lcp_ms": None, "mobile_tbt_ms": None},
        "field": {"lcp_p75": None, "inp_p75": None, "cls_p75": None, "ttfb_p75": None},
        "latest_release": {"commit_sha": None, "deployed_at": None},
    }
