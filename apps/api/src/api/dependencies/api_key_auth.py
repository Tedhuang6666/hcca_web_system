"""ApiKey 認證 dependency。

用於 Public API 路由：

    @router.get("/public/announcements", dependencies=[Depends(api_key_required)])

或可選認證（取得使用者 / API key context）：

    api_key: Annotated[ApiKey, Depends(api_key_required)]

授權檢查（scope）：

    api_key: Annotated[ApiKey, Depends(require_api_scope("read:announcements"))]
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.models.api_key import ApiKey
from api.services import api_key as api_key_svc


async def api_key_required(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ApiKey:
    raw = request.headers.get("x-api-key") or _extract_bearer(request)
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少 X-API-Key header",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    row = await api_key_svc.find_active_by_raw(db, raw)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key 無效、已撤銷或已過期",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    # 更新 last_used（best effort、不阻擋）
    try:
        ip = request.client.host if request.client else None
        await api_key_svc.touch_used(db, row.id, ip=ip)
    except Exception:  # nosec B110  # pragma: no cover
        pass
    return row


def _extract_bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    parts = auth.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return None


class ApiScopeChecker:
    """要求 ApiKey 帶有特定 scope。"""

    def __init__(self, *scopes: str) -> None:
        self.required_scopes = frozenset(scopes)

    async def __call__(
        self,
        api_key: Annotated[ApiKey, Depends(api_key_required)],
    ) -> ApiKey:
        granted = frozenset(api_key.scopes or [])
        if not (self.required_scopes & granted):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(f"API key 缺少所需 scope：{sorted(self.required_scopes)}"),
            )
        return api_key


def require_api_scope(*scopes: str) -> ApiScopeChecker:
    return ApiScopeChecker(*scopes)


__all__ = ["ApiScopeChecker", "api_key_required", "require_api_scope"]
