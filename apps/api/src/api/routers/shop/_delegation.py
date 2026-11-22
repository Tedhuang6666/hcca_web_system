from __future__ import annotations

import uuid
from collections.abc import Awaitable

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from api.models.shop import (
    Order,
)
from api.models.user import User
from api.routers.shop._common import _PAYMENT_WRITE_CODES, CurrentUser, DbDep, _get_order_or_404
from api.schemas.shop import (
    CurrentRegistrationUpdate,
    OrderItemQuantityUpdate,
    OrderOut,
    ProductOut,
    ShopDelegationAccess,
    ShopDelegationCodeCreate,
    ShopDelegationCodeOut,
    ShopDelegationContextOut,
    ShopDelegationCreate,
    ShopDelegationOut,
    ShopDelegationPromotionUpdate,
    ShopDelegationRegistrationUpdate,
    ShopDelegationUpdate,
    ShopPromotionPreviewOut,
)
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.permission import get_user_permission_codes
from api.services.shop import _delegation as delegation_svc
from api.services.shop import _delegation_codes as delegation_code_svc
from api.services.shop import _orders as orders_svc
from api.services.shop._events import queue_order_updated

router = APIRouter()


async def _delegation_result[T](operation: Awaitable[T]) -> T:
    try:
        return await operation
    except (delegation_svc.DelegationError, delegation_code_svc.DelegationCodeError) as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except StaleDataError as error:
        raise HTTPException(status_code=409, detail="庫存已更新，請重新載入") from error
    except shop_svc.PurchaseLimitError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/delegation-links", response_model=list[ShopDelegationOut])
async def list_delegation_links(
    session: DbDep, current_user: CurrentUser
) -> list[ShopDelegationOut]:
    return await delegation_svc.list_links(session, current_user)


@router.post("/delegation-links", response_model=ShopDelegationOut, status_code=201)
async def create_delegation_link(
    payload: ShopDelegationCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationOut:
    return await _delegation_result(delegation_svc.create_link(session, current_user, payload))


@router.patch("/delegation-links/{link_id}", response_model=ShopDelegationOut)
async def rename_delegation_link(
    link_id: uuid.UUID,
    payload: ShopDelegationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationOut:
    return await _delegation_result(
        delegation_svc.rename_link(
            session,
            current_user,
            link_id,
            payload.name,
        )
    )


@router.delete("/delegation-links/{link_id}", status_code=204)
async def revoke_delegation_link(
    link_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    link = await _delegation_result(delegation_svc.revoke_link(session, current_user, link_id))
    await audit_svc.record(
        session,
        entity_type="shop_delegation_link",
        entity_id=str(link.id),
        action="shop.delegation_revoke",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"撤銷代訂連結「{link.name}」",
    )


@router.post("/delegation-links/{link_id}/renew", response_model=ShopDelegationOut, status_code=201)
async def renew_delegation_link(
    link_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationOut:
    return await _delegation_result(delegation_svc.renew_link(session, current_user, link_id))


@router.post("/delegation/access", response_model=ShopDelegationContextOut)
async def access_delegation(
    payload: ShopDelegationAccess,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationContextOut:
    result = await _delegation_result(
        delegation_svc.context(
            session,
            current_user,
            payload.token,
            claim=payload.claim,
        )
    )
    if payload.claim:
        await audit_svc.record(
            session,
            entity_type="shop_delegation_link",
            entity_id=str(result.link.id),
            action="shop.delegation_claim",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            summary=f"綁定代訂連結「{result.link.name}」",
        )
    return result


@router.post("/delegation/code", response_model=ShopDelegationCodeOut)
async def exchange_delegation_code(
    payload: ShopDelegationCodeCreate,
    request: Request,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopDelegationCodeOut:
    token = await _delegation_result(
        delegation_code_svc.exchange_code(
            payload.code,
            actor_id=str(current_user.id),
            client_ip=request.client.host if request.client else "unknown",
        )
    )
    # 回傳完整連結前必須確認未撤銷、帳號綁定、學生／活動仍有效及商品開放範圍。
    await _delegation_result(delegation_svc.resolve_link(session, current_user, token))
    return ShopDelegationCodeOut(token=token)


@router.post("/delegation/products/{product_id}/read", response_model=ProductOut)
async def read_delegation_product(
    product_id: uuid.UUID,
    payload: ShopDelegationAccess,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductOut:
    return await _delegation_result(
        delegation_svc.delegated_product(
            session,
            current_user,
            payload.token,
            product_id,
        )
    )


async def _delegation_order_response(
    session: AsyncSession,
    actor: User,
    order: Order | None,
) -> OrderOut | None:
    if order is None:
        return None
    await audit_svc.record(
        session,
        entity_type="order",
        entity_id=str(order.id),
        action="shop.delegation_update",
        actor_id=str(actor.id),
        actor_email=actor.email,
        summary=f"更新代訂登記「{order.serial_number}」",
    )
    full = await shop_svc.get_order(session, order.id)
    updated = full or order
    await queue_order_updated(session, updated)
    return shop_svc.serialize_order(updated)


@router.post("/delegation/products/{product_id}", response_model=OrderOut | None)
async def update_delegation_product(
    product_id: uuid.UUID,
    payload: ShopDelegationRegistrationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut | None:
    order = await _delegation_result(
        delegation_svc.set_product(
            session,
            current_user,
            payload.token,
            product_id,
            CurrentRegistrationUpdate(variants=payload.variants),
        )
    )
    return await _delegation_order_response(session, current_user, order)


@router.post("/delegation/promotion/preview", response_model=ShopPromotionPreviewOut)
async def preview_delegation_promotion(
    payload: ShopDelegationPromotionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ShopPromotionPreviewOut:
    link, student = await _delegation_result(
        delegation_svc.resolve_link(
            session,
            current_user,
            payload.token,
            write=True,
        )
    )
    return await _delegation_result(delegation_svc.preview(session, student, link, payload.code))


@router.post("/delegation/promotion", response_model=OrderOut)
async def apply_delegation_promotion(
    payload: ShopDelegationPromotionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut:
    link, student = await _delegation_result(
        delegation_svc.resolve_link(
            session,
            current_user,
            payload.token,
            write=True,
        )
    )
    order = await _delegation_result(
        shop_svc.apply_registration_promotion(
            session,
            student,
            code=payload.code,
            activity_id=link.activity_id,
            category_id=None if link.activity_id else link.category_id,
        )
    )
    result = await _delegation_order_response(session, current_user, order)
    assert result is not None
    return result


@router.patch("/orders/{order_id}/items/{item_id}", response_model=OrderOut | None)
async def update_owned_order_item(
    order_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: OrderItemQuantityUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> OrderOut | None:
    codes = await get_user_permission_codes(session, current_user.id)
    is_order_manager = current_user.is_superuser or bool(_PAYMENT_WRITE_CODES & set(codes))
    option_ids = payload.option_ids if "option_ids" in payload.model_fields_set else None
    if is_order_manager:
        order = await _get_order_or_404(order_id, session, current_user)
        try:
            updated_order = await orders_svc.update_order_item_quantity(
                session,
                order,
                item_id,
                quantity=payload.quantity,
                option_ids=option_ids,
            )
        except StaleDataError as error:
            raise HTTPException(status_code=409, detail="庫存已更新，請重新載入") from error
        except shop_svc.PurchaseLimitError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        await audit_svc.record(
            session,
            entity_type="order",
            entity_id=str(updated_order.id),
            action="shop.order_item_quantity_update",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={
                "serial_number": updated_order.serial_number,
                "item_id": str(item_id),
                "quantity": payload.quantity,
                "option_ids": [str(value) for value in option_ids]
                if option_ids is not None
                else None,
            },
            summary=f"調整商品訂單「{updated_order.serial_number}」品項規格與數量",
        )
        refreshed = await shop_svc.get_order(session, updated_order.id)
        result = refreshed or updated_order
        await queue_order_updated(session, result)
        return shop_svc.serialize_order(result)

    order = await _delegation_result(
        delegation_svc.update_owned_item(
            session,
            current_user,
            order_id,
            item_id,
            payload.quantity,
            option_ids=option_ids,
        )
    )
    return await _delegation_order_response(session, current_user, order)
