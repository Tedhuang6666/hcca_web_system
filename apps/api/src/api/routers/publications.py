"""發布中心 API。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.user import User
from api.schemas.publication import (
    PublicationCampaignCreate,
    PublicationCampaignOut,
    PublicationCampaignUpdate,
    PublicationPreviewOut,
    PublicationStatsOut,
)
from api.services import audit as audit_svc
from api.services import publication as publication_svc

router = APIRouter(prefix="/publications", tags=["發布中心"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


@router.get(
    "",
    response_model=list[PublicationCampaignOut],
    summary="列出發布任務",
    dependencies=[Depends(require_permission("announcement:create"))],
)
async def list_publications(
    db: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=200),
) -> list[PublicationCampaignOut]:
    rows = await publication_svc.list_campaigns(
        db, activity_id=activity_id, status=status_filter, limit=limit
    )
    return [PublicationCampaignOut.model_validate(row) for row in rows]


@router.post(
    "",
    response_model=PublicationCampaignOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立發布任務",
    dependencies=[Depends(require_permission("announcement:create"))],
)
async def create_publication(
    body: PublicationCampaignCreate, db: DbDep, current_user: CurrentUser
) -> PublicationCampaignOut:
    campaign = await publication_svc.create_campaign(db, body, actor_id=current_user.id)
    await audit_svc.record(
        db,
        entity_type="publication",
        entity_id=str(campaign.id),
        action="publication.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json"),
        summary=f"建立發布任務：{campaign.title}",
    )
    return PublicationCampaignOut.model_validate(campaign)


@router.get(
    "/{campaign_id}",
    response_model=PublicationCampaignOut,
    summary="取得發布任務",
    dependencies=[Depends(require_permission("announcement:create"))],
)
async def get_publication(
    campaign_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> PublicationCampaignOut:
    campaign = await publication_svc.get_campaign(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="發布任務不存在")
    return PublicationCampaignOut.model_validate(campaign)


@router.patch(
    "/{campaign_id}",
    response_model=PublicationCampaignOut,
    summary="更新發布任務",
    dependencies=[Depends(require_permission("announcement:create"))],
)
async def update_publication(
    campaign_id: uuid.UUID,
    body: PublicationCampaignUpdate,
    db: DbDep,
    current_user: CurrentUser,
) -> PublicationCampaignOut:
    campaign = await publication_svc.get_campaign(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="發布任務不存在")
    campaign = await publication_svc.update_campaign(db, campaign, body)
    await audit_svc.record(
        db,
        entity_type="publication",
        entity_id=str(campaign.id),
        action="publication.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=body.model_dump(mode="json", exclude_unset=True),
        summary=f"更新發布任務：{campaign.title}",
    )
    return PublicationCampaignOut.model_validate(campaign)


@router.post(
    "/{campaign_id}/preview",
    response_model=PublicationPreviewOut,
    summary="預覽發布內容",
    dependencies=[Depends(require_permission("announcement:create"))],
)
async def preview_publication(
    campaign_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> PublicationPreviewOut:
    campaign = await publication_svc.get_campaign(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="發布任務不存在")
    return PublicationPreviewOut(**await publication_svc.preview(campaign))


@router.post(
    "/{campaign_id}/send",
    response_model=PublicationCampaignOut,
    summary="送出發布任務",
    dependencies=[Depends(require_permission("announcement:publish"))],
)
async def send_publication(
    campaign_id: uuid.UUID, db: DbDep, current_user: CurrentUser
) -> PublicationCampaignOut:
    campaign = await publication_svc.get_campaign(db, campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="發布任務不存在")
    campaign = await publication_svc.send(db, campaign)
    await audit_svc.record(
        db,
        entity_type="publication",
        entity_id=str(campaign.id),
        action="publication.send",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"送出發布任務：{campaign.title}",
    )
    return PublicationCampaignOut.model_validate(campaign)


@router.get(
    "/{campaign_id}/stats",
    response_model=PublicationStatsOut,
    summary="取得發布統計",
    dependencies=[Depends(require_permission("announcement:create"))],
)
async def publication_stats(
    campaign_id: uuid.UUID, db: DbDep, _: CurrentUser
) -> PublicationStatsOut:
    return PublicationStatsOut(**await publication_svc.stats(db, campaign_id))
