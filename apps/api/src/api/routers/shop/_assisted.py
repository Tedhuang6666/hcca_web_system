from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any, require_permission
from api.models.user import User
from api.routers.shop._common import _PAYMENT_WRITE_CODES, CurrentUser, DbDep
from api.schemas.shop import (
    AdminAssistedOrderCreate,
    ClassOrderCreate,
    ClassOrderUpsert,
    OrderOut,
    ShopOrdersClearOut,
)
from api.services import audit as audit_svc
from api.services import school_class as class_svc
from api.services import shop as shop_svc
from api.services.shop import _lookups as lookups_svc
from api.services.shop._events import queue_order_updated

router = APIRouter()


@router.post(
    "/orders/assisted",
    response_model=list[OrderOut],
    status_code=status.HTTP_201_CREATED,
    summary="訂單管理員替任意班級學生代訂",
    dependencies=[Depends(require_any(*_PAYMENT_WRITE_CODES))],
)
async def create_admin_assisted_order(
    payload: AdminAssistedOrderCreate, session: DbDep, current_user: CurrentUser
) -> list[OrderOut]:
    return await _create_assisted_orders(
        payload,
        session,
        current_user,
        allow_all_classes=True,
        separate_payment=payload.collection_mode == "separate",
        gift=payload.collection_mode == "gift",
        payment_method=payload.payment_method,
    )


async def _create_assisted_orders(
    payload: ClassOrderCreate,
    session: AsyncSession,
    current_user: User,
    *,
    allow_all_classes: bool = False,
    separate_payment: bool = False,
    gift: bool = False,
    payment_method: str = "cash_on_pickup",
) -> list[OrderOut]:
    from api.services.user_registration import UserRegistrationError

    try:
        if payload.roster_entry_id is not None:
            target, target_class = await class_svc.prepare_roster_order_recipient(
                session,
                roster_entry_id=payload.roster_entry_id,
                actor=current_user,
                allow_all_classes=allow_all_classes,
                product_ids=[item.product_id for item in payload.items],
            )
        else:
            target = await lookups_svc.get_buyer(session, payload.user_id)
            if target is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此學生")
            if not target.is_active:
                raise PermissionError("此學生帳號已停用")
            target_class = await class_svc.resolve_user_class(session, target)
            cadre_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
            if target_class is None or (
                not allow_all_classes
                and not current_user.is_superuser
                and target_class.id not in cadre_ids
            ):
                raise PermissionError("無權替此學生訂購")
        orders = await shop_svc.create_direct_order(
            session,
            user_id=target.id,
            class_id=target_class.id,
            data=ClassOrderUpsert(user_id=target.id, items=payload.items, notes=payload.notes),
            assisted_by_id=current_user.id,
            assistance_scope=(
                "council_gift"
                if gift
                else "council_separate"
                if separate_payment
                else "council_assisted"
            )
            if allow_all_classes
            else "class_assisted",
            payment_method=payment_method if separate_payment else "school_collection",
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except LookupError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except UserRegistrationError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="學生帳號或訂單資料已更新，請重新整理後再試",
        ) from e
    except StaleDataError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="庫存發生並發衝突") from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    result: list[OrderOut] = []
    for order in orders:
        full = await shop_svc.get_order(session, order.id)
        result.append(shop_svc.serialize_order(full or order))
        await queue_order_updated(session, full or order)
    return result


@router.delete(
    "/orders",
    response_model=ShopOrdersClearOut,
    summary="清除全部商品訂購資料",
    description=(
        "僅限商品管理者。刪除所有商品訂單與訂單明細，清除相關應收款及尚未寄出的確認通知，"
        "並回補仍占用的有限庫存與優惠使用次數；商品目錄和稽核紀錄保留。"
        "仍有已收款訂單時拒絕執行（409），避免一併刪除金流紀錄。"
    ),
    dependencies=[Depends(require_permission(PermissionCode.SHOP_MANAGE))],
)
async def clear_all_order_data(session: DbDep, current_user: CurrentUser) -> ShopOrdersClearOut:
    try:
        deleted_order_count = await shop_svc.clear_all_orders(session)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    await audit_svc.record(
        session,
        entity_type="shop_order_data",
        entity_id="all",
        action="shop.orders_clear_all",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"deleted_order_count": deleted_order_count},
        summary=f"清除全部商品訂購資料（{deleted_order_count} 筆訂單）",
    )
    return ShopOrdersClearOut(deleted_order_count=deleted_order_count)
