"""Admin Impersonation 路由。Phase C3。

端點：
    POST /admin/impersonate/{target_user_id}    啟動（回傳短效 token）
    POST /admin/impersonate/{target_user_id}/end  結束（撤銷 token）

前端：
    1. 點「以 X 身分檢視」→ POST /admin/impersonate/{id}
    2. 拿到 token → 切換為使用此 token 呼叫所有 API
    3. 上方顯示橘色 banner、點「結束模擬」→ POST .../end + 清 token

注意：
    - impersonation 預設 read-only（middleware 攔截寫入）
    - 不能 impersonate 自己 / superuser（除非自己也是 superuser）
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.security import add_to_blacklist
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.services import impersonation as impersonation_svc

router = APIRouter(prefix="/admin/impersonate", tags=["管理員代理登入"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


class ImpersonationStartResponse(BaseModel):
    token: str = Field(
        ..., description="短效 impersonation JWT，請存入記憶體並用作後續 Authorization Bearer"
    )
    expires_in_minutes: int
    target_user_id: uuid.UUID
    target_email: str


@router.post(
    "/{target_user_id}",
    response_model=ImpersonationStartResponse,
)
async def start_impersonation(
    target_user_id: uuid.UUID,
    request: Request,
    db: DbDep,
    actor: Annotated[User, Depends(require_permission(PermissionCode.ADMIN_IMPERSONATE))],
    minutes: int = Body(default=impersonation_svc.IMPERSONATION_DEFAULT_MINUTES, embed=True),
) -> ImpersonationStartResponse:
    target = await db.get(User, target_user_id)
    if target is None:
        raise HTTPException(404, "目標使用者不存在")
    if not target.is_active:
        raise HTTPException(400, "目標使用者已停用")

    try:
        token = impersonation_svc.create_impersonation_token(
            actor=actor, target=target, minutes=minutes
        )
    except impersonation_svc.ImpersonationError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    ip = request.client.host if request.client else None
    minutes_used = max(1, min(minutes, impersonation_svc.IMPERSONATION_MAX_MINUTES))
    await impersonation_svc.record_start(
        db,
        actor=actor,
        target_user_id=target.id,
        minutes=minutes_used,
        ip_address=ip,
    )
    await db.commit()

    return ImpersonationStartResponse(
        token=token,
        expires_in_minutes=minutes_used,
        target_user_id=target.id,
        target_email=target.email,
    )


class ImpersonationEndBody(BaseModel):
    token: str = Field(..., description="要撤銷的 impersonation token")
    reason: str = Field("explicit_end", max_length=200)


@router.post(
    "/end",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def end_impersonation(
    body: ImpersonationEndBody,
    db: DbDep,
    actor: Annotated[User, Depends(require_permission(PermissionCode.ADMIN_IMPERSONATE))],
) -> None:
    claims = impersonation_svc.parse_impersonation_token(body.token)
    if claims is None:
        raise HTTPException(400, "提供的不是 impersonation token")

    # 寫黑名單（撤銷 jti）
    await add_to_blacklist(body.token)

    await impersonation_svc.record_end(
        db,
        actor_id=str(actor.id),
        actor_email=actor.email,
        target_user_id=str(claims.get("sub")),
        reason=body.reason,
    )
    await db.commit()
