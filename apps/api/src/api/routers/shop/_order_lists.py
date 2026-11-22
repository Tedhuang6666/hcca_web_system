from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from api.dependencies.permissions import require_any
from api.models.shop import (
    OrderStatus,
)
from api.routers.shop._common import _ADMIN_VIEW_CODES, CurrentUser, DbDep
from api.schemas.shop import (
    OrderListItem,
    ShopClassRepresentativeRecipientOut,
    ShopDelegatedOrderOut,
)
from api.services import activity as activity_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _delegation as delegation_svc
from api.services.shop._testing import can_test_products

router = APIRouter()


@router.get("/orders", response_model=list[OrderListItem], summary="列出訂單")
async def list_orders(
    session: DbDep,
    current_user: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    my_only: bool = Query(True, description="僅顯示我的訂單"),
    grade: int | None = Query(None, description="按年級篩選（需 SHOP_VIEW_ALL 權限）"),
    class_id: uuid.UUID | None = Query(None, description="按班級篩選（需 SHOP_VIEW_ALL 權限）"),
    product_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    search: str | None = Query(None, max_length=100),
    limit: int = Query(20, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    is_admin = current_user.is_superuser
    if not is_admin:
        codes = await get_user_permission_codes(session, current_user.id)
        is_admin = bool(_ADMIN_VIEW_CODES & set(codes))
    if not my_only and not is_admin:
        can_view_activity = bool(
            activity_id
            and await activity_svc.can_manage_activity_resource(session, current_user, activity_id)
        )
        if not can_view_activity:
            my_only = True

    # grade/class_id 篩選只對管理員有效
    filter_grade = grade if is_admin else None
    filter_class_ids: list[uuid.UUID] | None = [class_id] if (is_admin and class_id) else None

    orders = await shop_svc.list_orders(
        session,
        user_id=current_user.id if my_only else None,
        activity_id=activity_id,
        status=status_filter,
        class_ids=filter_class_ids,
        grade=filter_grade,
        product_id=product_id if is_admin else None,
        category_id=category_id if is_admin else None,
        is_paid=is_paid if is_admin else None,
        date_from=date_from if is_admin else None,
        date_to=date_to if is_admin else None,
        search=search if is_admin else None,
        limit=limit,
        offset=offset,
        include_testing=await can_test_products(session, current_user),
    )
    return [shop_svc.serialize_order_list_item(o) for o in orders]


@router.get(
    "/orders/reminder-targets/class-representatives",
    response_model=list[ShopClassRepresentativeRecipientOut],
    summary="列出目前班代繳款提醒收件人",
    dependencies=[Depends(require_any(*_ADMIN_VIEW_CODES))],
)
async def list_class_representative_reminder_targets(
    session: DbDep,
) -> list[ShopClassRepresentativeRecipientOut]:
    rows = await class_svc.list_class_representative_recipients(session)
    return [ShopClassRepresentativeRecipientOut(**row) for row in rows]


@router.get(
    "/orders/delegated",
    response_model=list[ShopDelegatedOrderOut],
    summary="列出本人代訂的學生訂單",
)
async def list_delegated_orders(
    session: DbDep,
    current_user: CurrentUser,
    order_id: uuid.UUID | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[ShopDelegatedOrderOut]:
    return await delegation_svc.list_delegated_orders(
        session,
        current_user,
        order_id=order_id,
        limit=limit,
        offset=offset,
    )
