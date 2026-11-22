"""ApiKey 管理路由。

管理員（permission: api_key:admin）：
    GET    /api-keys                    列所有 key（不含明文）
    POST   /api-keys                    建立新 key（回傳一次性明文）
    GET    /api-keys/{id}               查單筆
    POST   /api-keys/{id}/revoke        撤銷
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.api_key import (
    ApiKeyCreate,
    ApiKeyCreatedResponse,
    ApiKeyOut,
    ApiKeyRevoke,
)
from api.services import api_key as api_key_svc

router = APIRouter(prefix="/api-keys", tags=["API Keys"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "",
    response_model=list[ApiKeyOut],
    dependencies=[Depends(require_permission("api_key:admin"))],
)
async def admin_list(db: DbDep, include_revoked: bool = False) -> list[ApiKeyOut]:
    rows = await api_key_svc.list_all(db, include_revoked=include_revoked)
    return [ApiKeyOut.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=ApiKeyCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create(
    body: ApiKeyCreate,
    db: DbDep,
    user: Annotated[User, Depends(require_permission("api_key:admin"))],
) -> ApiKeyCreatedResponse:
    row, raw = await api_key_svc.create_api_key(
        db,
        owner_user_id=user.id,
        name=body.name,
        scopes=body.scopes,
        rate_limit_per_minute=body.rate_limit_per_minute,
        expires_at=body.expires_at,
    )
    await db.commit()
    return ApiKeyCreatedResponse(
        api_key=ApiKeyOut.model_validate(row),
        key_plaintext=raw,
    )


@router.get(
    "/{api_key_id}",
    response_model=ApiKeyOut,
    dependencies=[Depends(require_permission("api_key:admin"))],
)
async def admin_get(api_key_id: uuid.UUID, db: DbDep) -> ApiKeyOut:
    row = await api_key_svc.get_by_id(db, api_key_id)
    if row is None:
        raise HTTPException(404, "API key 不存在")
    return ApiKeyOut.model_validate(row)


@router.post(
    "/{api_key_id}/revoke",
    response_model=ApiKeyOut,
    dependencies=[Depends(require_permission("api_key:admin"))],
)
async def admin_revoke(api_key_id: uuid.UUID, body: ApiKeyRevoke, db: DbDep) -> ApiKeyOut:
    try:
        row = await api_key_svc.revoke(db, api_key_id, reason=body.reason)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(404, str(exc)) from exc
    return ApiKeyOut.model_validate(row)
