"""Webhook 訂閱管理路由。

管理員（webhook:admin）：
    GET    /webhooks                 列所有
    POST   /webhooks                 建立（回傳一次性 signing secret）
    GET    /webhooks/{id}            單筆
    PATCH  /webhooks/{id}            更新
    DELETE /webhooks/{id}            刪除
    GET    /webhooks/{id}/deliveries 投遞紀錄
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.permissions import require_permission
from api.models.webhook import WebhookDelivery
from api.schemas.webhook import (
    WebhookDeliveryOut,
    WebhookSubscriptionCreate,
    WebhookSubscriptionCreatedResponse,
    WebhookSubscriptionOut,
    WebhookSubscriptionUpdate,
)
from api.services import webhook as webhook_svc

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get(
    "",
    response_model=list[WebhookSubscriptionOut],
    dependencies=[Depends(require_permission("webhook:admin"))],
)
async def admin_list_subscriptions(
    db: DbDep, only_active: bool = False
) -> list[WebhookSubscriptionOut]:
    rows = await webhook_svc.list_subscriptions(db, only_active=only_active)
    return [WebhookSubscriptionOut.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=WebhookSubscriptionCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def admin_create_subscription(
    body: WebhookSubscriptionCreate,
    db: DbDep,
    user=Depends(require_permission("webhook:admin")),
) -> WebhookSubscriptionCreatedResponse:
    try:
        row, secret = await webhook_svc.create_subscription(
            db,
            owner_user_id=user.id,
            name=body.name,
            url=str(body.url),
            events=body.events,
            description=body.description,
            max_retries=body.max_retries,
        )
    except webhook_svc.UnsafeWebhookUrlError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    await db.commit()
    return WebhookSubscriptionCreatedResponse(
        subscription=WebhookSubscriptionOut.model_validate(row),
        signing_secret=secret,
    )


@router.get(
    "/{subscription_id}",
    response_model=WebhookSubscriptionOut,
    dependencies=[Depends(require_permission("webhook:admin"))],
)
async def admin_get_subscription(subscription_id: uuid.UUID, db: DbDep) -> WebhookSubscriptionOut:
    row = await webhook_svc.get_subscription(db, subscription_id)
    if row is None:
        raise HTTPException(404, "訂閱不存在")
    return WebhookSubscriptionOut.model_validate(row)


@router.patch(
    "/{subscription_id}",
    response_model=WebhookSubscriptionOut,
    dependencies=[Depends(require_permission("webhook:admin"))],
)
async def admin_update_subscription(
    subscription_id: uuid.UUID, body: WebhookSubscriptionUpdate, db: DbDep
) -> WebhookSubscriptionOut:
    try:
        row = await webhook_svc.update_subscription(
            db,
            subscription_id,
            name=body.name,
            url=str(body.url) if body.url else None,
            events=body.events,
            description=body.description,
            is_active=body.is_active,
            max_retries=body.max_retries,
        )
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(404, str(exc)) from exc
    return WebhookSubscriptionOut.model_validate(row)


@router.delete(
    "/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission("webhook:admin"))],
)
async def admin_delete_subscription(subscription_id: uuid.UUID, db: DbDep) -> None:
    await webhook_svc.delete_subscription(db, subscription_id)
    await db.commit()


@router.get(
    "/{subscription_id}/deliveries",
    response_model=list[WebhookDeliveryOut],
    dependencies=[Depends(require_permission("webhook:admin"))],
)
async def admin_list_deliveries(
    subscription_id: uuid.UUID,
    db: DbDep,
    limit: int = 50,
) -> list[WebhookDeliveryOut]:
    stmt = (
        select(WebhookDelivery)
        .where(WebhookDelivery.subscription_id == subscription_id)
        .order_by(desc(WebhookDelivery.created_at))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [WebhookDeliveryOut.model_validate(r) for r in rows]
