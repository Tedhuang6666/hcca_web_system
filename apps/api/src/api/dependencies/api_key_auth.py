"""ApiKey 認證 dependency。

用於 Public API 路由：

    @router.get("/public/announcements", dependencies=[Depends(api_key_required)])

或可選認證（取得使用者 / API key context）：

    api_key: Annotated[ApiKey, Depends(api_key_required)]

授權檢查（scope）：

    api_key: Annotated[ApiKey, Depends(require_api_scope("read:announcements"))]
"""

from __future__ import annotations

import logging
import time
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.security import redis_client
from api.models.api_key import ApiKey
from api.services import api_key as api_key_svc

logger = logging.getLogger(__name__)


async def _enforce_rate_limit(api_key: ApiKey) -> None:
    """以 API key ID 做跨 worker 的固定視窗限流；Redis 故障時拒絕對外 API。"""
    minute = int(time.time() // 60)
    key = f"api_key_rate:{api_key.id}:{minute}"
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, 120)
        count, _ = await pipe.execute()
    except (RedisError, TimeoutError) as exc:
        logger.error("API key rate limit Redis 不可用，拒絕請求")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API key 限流服務暫時不可用",
        ) from exc
    if int(count) > api_key.rate_limit_per_minute:
        retry_after = 60 - (int(time.time()) % 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="已超過此 API key 的每分鐘請求上限",
            headers={"Retry-After": str(retry_after)},
        )


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
    await _enforce_rate_limit(row)
    # 更新 last_used（best effort、不阻擋）
    try:
        ip = request.client.host if request.client else None
        await api_key_svc.touch_used(db, row.id, ip=ip)
    except Exception:  # pragma: no cover
        logger.debug("API key last_used 更新失敗（non-critical）", exc_info=True)
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
