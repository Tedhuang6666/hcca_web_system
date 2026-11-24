from __future__ import annotations

import uuid
from datetime import date, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from api.core.clock import local_today
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.models.shop import (
    OrderStatus,
)
from api.routers.shop._common import _ADMIN_VIEW_CODES, CurrentUser, DbDep, ManagerUser
from api.schemas.shop import (
    ClassPaymentReportItemOut,
    OrderDistributionRow,
    OrderPurchaseDetailRow,
    OrderQuantityRow,
    OrderSummaryOut,
)
from api.schemas.shop_analytics import ShopSalesAnalyticsOut, ShopSalesReportCreate
from api.services import shop as shop_svc
from api.services.shop._analytics import sales_analytics
from api.services.shop._analytics_report import create_sales_report
from api.services.shop._purchase_report import purchase_details_report
from api.services.shop._quantity_export import export_quantity_excel

router = APIRouter()


@router.get(
    "/orders/analytics",
    response_model=ShopSalesAnalyticsOut,
    summary="活動與品項銷售分析（台北時間、最多 366 天）",
    dependencies=[Depends(require_any(*_ADMIN_VIEW_CODES))],
)
async def order_sales_analytics(
    session: DbDep,
    _: CurrentUser,
    date_from: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
    date_to: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
    compare: bool = Query(False),
    compare_from: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
    activity_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None, ge=0),
    class_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
) -> ShopSalesAnalyticsOut:
    try:
        return await sales_analytics(
            session,
            date_from=date_from,
            date_to=date_to,
            compare=compare,
            compare_from=compare_from,
            activity_id=activity_id,
            category_id=category_id,
            product_id=product_id,
            grade=grade,
            class_id=class_id,
            is_paid=is_paid,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/orders/analytics/report",
    summary="產生銷售分析 PDF 或 Excel 報告",
    dependencies=[Depends(require_any(*_ADMIN_VIEW_CODES))],
    responses={
        200: {
            "content": {
                "application/pdf": {},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
            }
        }
    },
)
async def sales_analysis_report(
    session: DbDep, _: CurrentUser, data: ShopSalesReportCreate
) -> Response:
    try:
        content, media_type, filename = await create_sales_report(session, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "private, no-store",
        },
    )


@router.get(
    "/orders/summary",
    response_model=OrderSummaryOut,
    summary="後台訂購統計（按班級 / 年級 / 個人）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.FINANCE_VIEW,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def order_summary(
    session: DbDep,
    _: CurrentUser,
    group_by: str = Query("class", pattern="^(class|grade|user)$"),
    activity_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None, ge=0),
    class_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    is_paid: bool | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> OrderSummaryOut:
    return await shop_svc.order_summary(
        session,
        group_by=group_by,
        activity_id=activity_id,
        product_id=product_id,
        category_id=category_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status_filter,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/orders/purchase-details",
    response_model=list[OrderPurchaseDetailRow],
    summary="訂單明細統計（按班級、訂購人、商品規格）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.FINANCE_VIEW,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def order_purchase_details(
    session: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None, ge=0),
    class_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    is_paid: bool | None = Query(None),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> list[OrderPurchaseDetailRow]:
    return await purchase_details_report(
        session,
        activity_id=activity_id,
        category_id=category_id,
        product_id=product_id,
        grade=grade,
        class_id=class_id,
        user_id=user_id,
        status=status_filter,
        is_paid=is_paid,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/orders/class-payments",
    response_model=list[ClassPaymentReportItemOut],
    summary="班聯目前確認收款的班級明細",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.FINANCE_VIEW,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def class_payment_report(
    session: DbDep,
    _: CurrentUser,
) -> list[ClassPaymentReportItemOut]:
    return await shop_svc.class_payment_report(session)


@router.get(
    "/orders/quantities",
    response_model=list[OrderQuantityRow],
    summary="商品規格訂購數量彙總（採購用）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def order_quantities(
    session: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None),
    class_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    user_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> list[OrderQuantityRow]:
    return await shop_svc.order_quantities(
        session,
        activity_id=activity_id,
        grade=grade,
        class_id=class_id,
        category_id=category_id,
        product_id=product_id,
        user_id=user_id,
        is_paid=is_paid,
        status=status_filter,
        date_from=date_from,
        date_to=date_to,
    )


@router.get(
    "/orders/distribution",
    response_model=list[OrderDistributionRow],
    summary="商品分貨數量（按班級與規格）",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.SHOP_VIEW_ALL,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def order_distribution(
    session: DbDep,
    _: CurrentUser,
    activity_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None, ge=0),
    class_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
) -> list[OrderDistributionRow]:
    return await shop_svc.order_distribution(
        session,
        activity_id=activity_id,
        grade=grade,
        class_id=class_id,
        category_id=category_id,
        product_id=product_id,
    )


@router.get(
    "/orders/quantities.xlsx",
    response_class=Response,
    summary="下載訂單統計詳情 Excel（含內部成本）",
    responses={
        200: {"content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}}}
    },
)
async def download_order_quantities(
    session: DbDep,
    _: ManagerUser,
    activity_id: uuid.UUID | None = Query(None),
    grade: int | None = Query(None),
    class_id: uuid.UUID | None = Query(None),
    category_id: uuid.UUID | None = Query(None),
    product_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
) -> Response:
    try:
        content = await export_quantity_excel(
            session,
            activity_id=activity_id,
            grade=grade,
            class_id=class_id,
            category_id=category_id,
            product_id=product_id,
            is_paid=is_paid,
            status=status_filter,
            date_from=date_from,
            date_to=date_to,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    filename = quote(f"訂單統計詳情_{local_today()}.xlsx")
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
            "Cache-Control": "private, no-store",
        },
    )
