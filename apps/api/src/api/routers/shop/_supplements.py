from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from api.routers.shop._common import _PAYMENT_WRITE_CODES, CurrentUser, DbDep
from api.schemas.shop import (
    OrderListItem,
)
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _supplements as supplement_svc

router = APIRouter()


@router.get("/orders/supplements", response_model=list[OrderListItem], summary="補收款清單")
async def list_supplement_orders(
    session: DbDep,
    current_user: CurrentUser,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[OrderListItem]:
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    cadre_ids = (
        None if can_manage else await class_svc.get_cadre_class_ids(session, current_user.id)
    )
    orders = await supplement_svc.list_supplements(
        session,
        actor_id=None if can_manage else current_user.id,
        class_ids=cadre_ids,
        limit=limit,
        offset=offset,
    )
    return [shop_svc.serialize_order_list_item(order) for order in orders]


@router.get("/orders/{order_id}/supplement-receipt.pdf", summary="下載單筆補收款收據")
async def download_supplement_receipt(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Response:
    order = await shop_svc.get_order(session, order_id)
    codes = await get_user_permission_codes(session, current_user.id)
    can_manage = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    if order is None or not (
        can_manage or current_user.id in {order.user_id, order.assisted_by_id}
    ):
        raise HTTPException(status_code=404, detail="找不到此補收款訂單")
    try:
        pdf = await supplement_svc.export_supplement_receipt(session, order)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="supplement-{order.serial_number}.pdf"',
            "Cache-Control": "no-store",
        },
    )
