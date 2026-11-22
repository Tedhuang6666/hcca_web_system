"""特約商家公開申請與管理端審核路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_optional_user
from api.dependencies.permissions import require_any
from api.models.partner_business_application import (
    PartnerApplicationSettings,
    PartnerBusinessApplication,
)
from api.models.user import User
from api.schemas.partner_business_application import (
    PartnerApplicationPortalOut,
    PartnerApplicationSettingsOut,
    PartnerApplicationSettingsUpdate,
    PartnerBusinessApplicationCreate,
    PartnerBusinessApplicationOut,
    PartnerBusinessApplicationReview,
)
from api.services import audit as audit_svc
from api.services import partner_business_application as application_svc

router = APIRouter(prefix="/partner-map", tags=["特約商家申請"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
ApplicationManagerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.PARTNER_MAP_MANAGE,
            PermissionCode.PARTNER_MAP_APPLICATION_MANAGE,
            PermissionCode.SITE_MANAGE,
        )
    ),
]
ApplicationReviewerUser = Annotated[
    User,
    Depends(
        require_any(
            PermissionCode.PARTNER_MAP_MANAGE,
            PermissionCode.PARTNER_MAP_APPLICATION_REVIEW,
        )
    ),
]


def _settings_out(settings: PartnerApplicationSettings) -> PartnerApplicationSettingsOut:
    return PartnerApplicationSettingsOut.model_validate(settings)


@router.get(
    "/applications/portal",
    response_model=PartnerApplicationPortalOut,
    summary="取得特約商家申請表單",
)
async def get_application_portal(db: DbDep) -> PartnerApplicationPortalOut:
    settings = await application_svc.get_settings(db)
    return PartnerApplicationPortalOut(
        settings=_settings_out(settings),
        is_accepting=settings.is_open,
    )


@router.post(
    "/applications",
    response_model=PartnerBusinessApplicationOut,
    status_code=status.HTTP_201_CREATED,
    summary="送出特約商家申請",
)
async def create_application(
    body: PartnerBusinessApplicationCreate,
    db: DbDep,
    viewer: OptionalUser,
) -> PartnerBusinessApplicationOut:
    try:
        application, _ = await application_svc.create_application(
            db, body, viewer.id if viewer else None
        )
    except ValueError as exc:
        detail = str(exc)
        code = (
            status.HTTP_409_CONFLICT
            if detail == "目前暫停受理特約商家申請"
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=code, detail=detail) from exc
    return PartnerBusinessApplicationOut.model_validate(application)


@router.get(
    "/admin/applications/settings",
    response_model=PartnerApplicationSettingsOut,
    summary="取得特約商家申請表單設定",
)
async def get_admin_application_settings(
    db: DbDep, _: ApplicationManagerUser
) -> PartnerApplicationSettingsOut:
    return _settings_out(await application_svc.get_settings(db))


@router.patch(
    "/admin/applications/settings",
    response_model=PartnerApplicationSettingsOut,
    summary="更新特約商家申請表單設定",
)
async def update_admin_application_settings(
    body: PartnerApplicationSettingsUpdate, db: DbDep, user: ApplicationManagerUser
) -> PartnerApplicationSettingsOut:
    settings = await application_svc.update_settings(db, body, user.id)
    await audit_svc.record(
        db,
        entity_type="partner_application_settings",
        entity_id=str(settings.id),
        action="partner_application.settings_update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary="更新特約商家申請表單設定",
    )
    return _settings_out(settings)


@router.get(
    "/admin/applications",
    response_model=list[PartnerBusinessApplicationOut],
    summary="列出特約商家申請",
)
async def list_admin_applications(
    db: DbDep,
    _: ApplicationReviewerUser,
    status_filter: str | None = Query(None, alias="status", max_length=20),
) -> list[PartnerBusinessApplication]:
    return await application_svc.list_applications(db, status_filter)


@router.patch(
    "/admin/applications/{application_id}",
    response_model=PartnerBusinessApplicationOut,
    summary="審核特約商家申請",
)
async def review_admin_application(
    application_id: uuid.UUID,
    body: PartnerBusinessApplicationReview,
    db: DbDep,
    user: ApplicationReviewerUser,
) -> PartnerBusinessApplicationOut:
    application = await application_svc.get_application(db, application_id)
    if application is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此特約商家申請")
    if body.business_id is not None:
        from api.services.partner_map import get_business

        if await get_business(db, body.business_id) is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="指定店家不存在"
            )
    updated = await application_svc.review_application(db, application, body, user.id)
    await audit_svc.record(
        db,
        entity_type="partner_business_application",
        entity_id=str(updated.id),
        action="partner_application.review",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary="審核特約商家申請",
    )
    return PartnerBusinessApplicationOut.model_validate(updated)
