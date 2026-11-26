from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from api.core.clock import local_today
from api.core.permission_codes import PermissionCode
from api.routers.shop._common import CurrentUser, DbDep, _require_shop_manager
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes

router = APIRouter()


@router.get(
    "/reports/orders.xlsx",
    response_class=Response,
    summary="匯出訂單報表（Excel）",
)
async def export_orders_excel(
    session: DbDep,
    current_user: CurrentUser,
    category_id: uuid.UUID | None = Query(None, description="商品分類"),
) -> Response:
    if category_id:
        await _require_shop_manager(session, current_user)
    elif not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        if not {str(PermissionCode.FINANCE_VIEW), str(PermissionCode.ADMIN_ALL)} & set(codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：finance:view"
            )
    xlsx_bytes = await shop_svc.export_orders_excel(session, category_id=category_id)
    filename = f"orders_{local_today()}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/reports/orders.csv",
    response_class=Response,
    summary="匯出訂單報表（CSV）",
)
async def export_orders_csv(
    session: DbDep,
    current_user: CurrentUser,
    category_id: uuid.UUID | None = Query(None, description="商品分類"),
) -> Response:
    if category_id:
        await _require_shop_manager(session, current_user)
    elif not current_user.is_superuser:
        codes = await get_user_permission_codes(session, current_user.id)
        if not {str(PermissionCode.FINANCE_VIEW), str(PermissionCode.ADMIN_ALL)} & set(codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：finance:view"
            )
    csv_str = await shop_svc.export_orders_csv(session, category_id=category_id)
    filename = f"orders_{local_today()}.csv"
    return Response(
        content=csv_str.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
