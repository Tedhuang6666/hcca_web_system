"""Feature Flag 路由。Phase D3。

已登入使用者：
    GET /feature-flags/me/{key}       查單一 flag 是否啟用
    GET /feature-flags/me             批次評估 user 對所有 flag 的結果

管理員（feature_flag:admin）：
    GET    /feature-flags             list
    POST   /feature-flags             create
    PATCH  /feature-flags/{id}        update
    POST   /feature-flags/{id}/archive
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.feature_flag import (
    FeatureFlagCreate,
    FeatureFlagEvaluation,
    FeatureFlagOut,
    FeatureFlagUpdate,
)
from api.services import feature_flag as ff_svc

router = APIRouter(prefix="/feature-flags", tags=["Feature Flags"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── me ──


@router.get("/me/{key}", response_model=FeatureFlagEvaluation)
async def evaluate_for_me(key: str, db: DbDep, user: CurrentUser) -> FeatureFlagEvaluation:
    enabled = await ff_svc.is_enabled(db, key, user)
    return FeatureFlagEvaluation(key=key, enabled=enabled)


@router.get("/me", response_model=list[FeatureFlagEvaluation])
async def evaluate_all_for_me(db: DbDep, user: CurrentUser) -> list[FeatureFlagEvaluation]:
    """批次回傳所有 flag 對目前 user 的評估，前端用以同步條件渲染。"""
    flags = await ff_svc.list_flags(db)
    out: list[FeatureFlagEvaluation] = []
    for f in flags:
        if f.archived_at is not None:
            continue
        enabled = await ff_svc.is_enabled(db, f.key, user)
        out.append(FeatureFlagEvaluation(key=f.key, enabled=enabled))
    return out


# ── admin ──


@router.get(
    "",
    response_model=list[FeatureFlagOut],
    dependencies=[Depends(require_permission(PermissionCode.FEATURE_FLAG_ADMIN))],
)
async def admin_list_flags(db: DbDep) -> list[FeatureFlagOut]:
    rows = await ff_svc.list_flags(db)
    return [FeatureFlagOut.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=FeatureFlagOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(PermissionCode.FEATURE_FLAG_ADMIN))],
)
async def admin_create_flag(body: FeatureFlagCreate, db: DbDep) -> FeatureFlagOut:
    try:
        row = await ff_svc.create_flag(db, key=body.key, description=body.description)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(409, f"flag key 已存在或不合法：{exc}") from exc
    return FeatureFlagOut.model_validate(row)


@router.patch(
    "/{flag_id}",
    response_model=FeatureFlagOut,
    dependencies=[Depends(require_permission(PermissionCode.FEATURE_FLAG_ADMIN))],
)
async def admin_update_flag(
    flag_id: uuid.UUID, body: FeatureFlagUpdate, db: DbDep
) -> FeatureFlagOut:
    try:
        row = await ff_svc.update_flag(
            db,
            flag_id,
            description=body.description,
            is_globally_enabled=body.is_globally_enabled,
            percentage_rollout=body.percentage_rollout,
            enabled_user_ids=body.enabled_user_ids,
            enabled_permission_codes=body.enabled_permission_codes,
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(404, str(exc)) from exc
    return FeatureFlagOut.model_validate(row)


@router.post(
    "/{flag_id}/archive",
    response_model=FeatureFlagOut,
    dependencies=[Depends(require_permission(PermissionCode.FEATURE_FLAG_ADMIN))],
)
async def admin_archive_flag(flag_id: uuid.UUID, db: DbDep) -> FeatureFlagOut:
    try:
        row = await ff_svc.archive_flag(db, flag_id)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(404, str(exc)) from exc
    return FeatureFlagOut.model_validate(row)
