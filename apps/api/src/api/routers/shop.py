"""購票 / 校商訂購系統 Router - 商品 / 訂單 / 報表匯出"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any, require_permission
from api.models.shop import Order, OrderStatus, Product, ProductStatus
from api.models.user import User
from api.schemas.shop import (
    OrderCancelRequest,
    OrderCreate,
    OrderListItem,
    OrderOut,
    ProductCreate,
    ProductOut,
    ProductUpdate,
)
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes

router = APIRouter(prefix="/shop", tags=["購票/校商訂購"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── 輔助 ─────────────────────────────────────────────────────────────────────


async def _get_product_or_404(product_id: uuid.UUID, session: DbDep) -> Product:
    p = await shop_svc.get_product(session, product_id)
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    return p


async def _get_order_or_404(order_id: uuid.UUID, session: DbDep) -> Order:
    o = await shop_svc.get_order(session, order_id)
    if o is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return o


# ── 商品端點 ──────────────────────────────────────────────────────────────────


@router.get("/products", response_model=list[ProductOut], summary="列出商品")
async def list_products(
    session: DbDep,
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    status_filter: ProductStatus | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Product]:
    return await shop_svc.list_products(
        session, org_id=org_id, status=status_filter, limit=limit, offset=offset
    )


@router.get("/products/{product_id}", response_model=ProductOut, summary="取得商品詳細")
async def get_product(product_id: uuid.UUID, session: DbDep, _: CurrentUser) -> Product:
    return await _get_product_or_404(product_id, session)


@router.post(
    "/products",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增商品（管理員）",
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def create_product(
    payload: ProductCreate, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await shop_svc.create_product(session, data=payload, created_by=current_user.id)
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(product.org_id), "name": product.name, "price": product.price},
        summary=f"建立商品「{product.name}」",
    )
    return product


@router.patch(
    "/products/{product_id}",
    response_model=ProductOut,
    summary="更新商品",
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def update_product(
    product_id: uuid.UUID, payload: ProductUpdate, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session)
    if product.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以編輯")
    before = {
        "name": product.name,
        "price": product.price,
        "stock_quantity": product.stock_quantity,
        "status": product.status.value,
    }
    try:
        product = await shop_svc.update_product(session, product, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": product.name,
                "price": product.price,
                "stock_quantity": product.stock_quantity,
                "status": product.status.value,
            },
        },
        summary=f"更新商品「{product.name}」",
    )
    return product


@router.post(
    "/products/{product_id}/activate",
    response_model=ProductOut,
    summary="上架商品",
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def activate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session)
    if product.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以上架")
    try:
        product = await shop_svc.activate_product(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_activate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"status": product.status.value},
        summary=f"上架商品「{product.name}」",
    )
    return product


@router.post(
    "/products/{product_id}/deactivate",
    response_model=ProductOut,
    summary="下架商品",
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def deactivate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session)
    if product.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以下架")
    try:
        product = await shop_svc.deactivate_product(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"status": product.status.value},
        summary=f"下架商品「{product.name}」",
    )
    return product


# ── 訂單端點 ──────────────────────────────────────────────────────────────────


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立訂單（含庫存扣減，樂觀鎖保護）",
)
async def create_order(payload: OrderCreate, session: DbDep, current_user: CurrentUser) -> Order:
    """
    高並發購票保護：使用 SQLAlchemy version_id_col 樂觀鎖。
    若發生版本衝突（StaleDataError），回傳 409 請客戶端重試。
    """
    try:
        order = await shop_svc.create_order(
            session, user_id=current_user.id, items=payload.items, notes=payload.notes
        )
    except StaleDataError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="庫存發生並發衝突，請稍後重試（商品已被他人搶購更新）",
        ) from e
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "serial_number": order.serial_number,
            "total_price": order.total_price,
            "item_count": len(payload.items),
        },
        summary=f"建立商品訂單「{order.serial_number}」",
    )
    return order


@router.get("/orders", response_model=list[OrderListItem], summary="列出訂單")
async def list_orders(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    status_filter: OrderStatus | None = Query(None, alias="status"),
    my_only: bool = Query(True, description="僅顯示我的訂單"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Order]:
    if not my_only:
        codes = await get_user_permission_codes(session, str(current_user.id))
        if "shop:manage" not in codes and "admin:all" not in codes and "finance:view" not in codes:
            my_only = True
    return await shop_svc.list_orders(
        session,
        user_id=current_user.id if my_only else None,
        org_id=org_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/orders/{order_id}", response_model=OrderOut, summary="取得訂單詳細")
async def get_order(order_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> Order:
    order = await _get_order_or_404(order_id, session)
    if order.user_id != current_user.id:
        codes = await get_user_permission_codes(session, str(current_user.id))
        if "shop:manage" not in codes and "admin:all" not in codes and "finance:view" not in codes:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此訂單")
    return order


@router.post("/orders/{order_id}/cancel", response_model=OrderOut, summary="取消訂單")
async def cancel_order(
    order_id: uuid.UUID,
    payload: OrderCancelRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Order:
    order = await _get_order_or_404(order_id, session)
    try:
        order = await shop_svc.cancel_order(
            session, order, requested_by=current_user.id, reason=payload.reason
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.order_cancel",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "reason": payload.reason},
        summary=f"取消商品訂單「{order.serial_number}」",
    )
    return order


# ── 報表匯出端點 [M-26] ────────────────────────────────────────────────────────


@router.get(
    "/reports/orders.xlsx",
    response_class=Response,
    summary="匯出訂單報表（Excel）",
    responses={
        200: {"content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}}}
    },
    dependencies=[Depends(require_any(PermissionCode.FINANCE_VIEW, PermissionCode.ADMIN_ALL))],
)
async def export_orders_excel(
    session: DbDep,
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織（留空匯出全部）"),
) -> Response:
    """下載訂單統計報表 Excel 檔案（管理員用）"""
    xlsx_bytes = await shop_svc.export_orders_excel(session, org_id=org_id)
    filename = f"orders_{__import__('datetime').date.today()}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/reports/orders.csv",
    response_class=Response,
    summary="匯出訂單報表（CSV）",
    responses={200: {"content": {"text/csv": {}}}},
    dependencies=[Depends(require_any(PermissionCode.FINANCE_VIEW, PermissionCode.ADMIN_ALL))],
)
async def export_orders_csv(
    session: DbDep,
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織"),
) -> Response:
    """下載訂單統計報表 CSV 檔案（UTF-8 with BOM，Excel 可直接開啟）"""
    csv_str = await shop_svc.export_orders_csv(session, org_id=org_id)
    filename = f"orders_{__import__('datetime').date.today()}.csv"
    return Response(
        content=csv_str.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
