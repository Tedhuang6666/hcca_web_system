from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from api.models.shop import (
    Product,
    ProductVariantGroup,
    ProductVariantOption,
)
from api.routers.shop._common import (
    CurrentUser,
    DbDep,
    _get_category_or_404,
    _get_product_or_404,
    _get_series_or_404,
    _get_variant_group_or_404,
    _get_variant_option_or_404,
    _require_shop_manager,
)
from api.schemas.shop import (
    ProductCreate,
    ProductOut,
    ProductReorder,
    ProductUpdate,
    ProductVariantGroupCreate,
    ProductVariantGroupOut,
    ProductVariantGroupUpdate,
    ProductVariantOptionCreate,
    ProductVariantOptionOut,
    ProductVariantOptionUpdate,
)
from api.services import audit as audit_svc
from api.services import shop as shop_svc
from api.services.shop._testing import can_test_products, start_product_testing

router = APIRouter()


@router.post(
    "/products",
    response_model=ProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增商品（可附變體）",
)
async def create_product(
    payload: ProductCreate, session: DbDep, current_user: CurrentUser
) -> Product:
    series = await _get_series_or_404(payload.series_id, session) if payload.series_id else None
    category_id = payload.category_id or (series.category_id if series else None)
    if category_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="請選擇商品分類",
        )
    category = await _get_category_or_404(category_id, session)
    if series and series.category_id != category.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="所選系列不屬於此商品分類",
        )
    await _require_shop_manager(session, current_user)
    try:
        product = await shop_svc.create_product(session, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": product.name, "price": product.price},
        summary=f"建立商品「{product.name}」",
    )
    return product


@router.patch("/products/order", response_model=list[ProductOut], summary="調整商品順序")
async def reorder_products(
    payload: ProductReorder, session: DbDep, current_user: CurrentUser
) -> list[Product]:
    if payload.parent_type == "category":
        await _get_category_or_404(payload.parent_id, session)
    else:
        series = await _get_series_or_404(payload.parent_id, session)
        await _get_category_or_404(series.category_id, session)
    await _require_shop_manager(session, current_user)
    try:
        return await shop_svc.reorder_products(
            session,
            payload,
            include_testing=await can_test_products(session, current_user),
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.patch("/products/{product_id}", response_model=ProductOut, summary="更新商品")
async def update_product(
    product_id: uuid.UUID,
    payload: ProductUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> Product:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    target_category_id = payload.category_id
    if payload.series_id:
        target_series = await _get_series_or_404(payload.series_id, session)
        target_category_id = payload.category_id or target_series.category_id
    if target_category_id is None:
        target_category_id = product.category_id
    if target_category_id is None and product.series is not None:
        target_category_id = product.series.category_id
    if target_category_id is not None:
        await _get_category_or_404(target_category_id, session)
        await _require_shop_manager(session, current_user)
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
        meta={"name": product.name, "price": product.price},
        summary=f"更新商品「{product.name}」",
    )
    return product


@router.post("/products/{product_id}/test", response_model=ProductOut, summary="開始測試商品")
async def test_product(product_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> Product:
    if not await can_test_products(session, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：shop:test")
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    try:
        product = await start_product_testing(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_test",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"開始測試商品「{product.name}」",
    )
    return product


@router.post("/products/{product_id}/activate", response_model=ProductOut, summary="上架商品")
async def activate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
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
        summary=f"上架商品「{product.name}」",
    )
    return product


@router.post("/products/{product_id}/deactivate", response_model=ProductOut, summary="下架商品")
async def deactivate_product(
    product_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> Product:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
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
        summary=f"下架商品「{product.name}」",
    )
    return product


@router.delete(
    "/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除商品",
)
async def delete_product(product_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    product = await _get_product_or_404(product_id, session, current_user)
    product_name = product.name
    await _require_shop_manager(session, current_user)
    try:
        await shop_svc.delete_product(session, product)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="product",
        entity_id=str(product.id),
        action="shop.product_delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"name": product_name},
        summary=f"刪除商品「{product_name}」",
    )


@router.post(
    "/products/{product_id}/variant-groups",
    response_model=ProductVariantGroupOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增變體群組",
)
async def add_variant_group(
    product_id: uuid.UUID,
    payload: ProductVariantGroupCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantGroup:
    product = await _get_product_or_404(product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    return await shop_svc.add_variant_group(session, product, data=payload)


@router.patch(
    "/variant-groups/{group_id}",
    response_model=ProductVariantGroupOut,
    summary="更新變體群組",
)
async def update_variant_group(
    group_id: uuid.UUID,
    payload: ProductVariantGroupUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantGroup:
    group = await _get_variant_group_or_404(group_id, session)
    await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    return await shop_svc.update_variant_group(session, group, data=payload)


@router.delete(
    "/variant-groups/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除變體群組",
)
async def delete_variant_group(
    group_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> None:
    group = await _get_variant_group_or_404(group_id, session)
    await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    await shop_svc.delete_variant_group(session, group)


@router.post(
    "/variant-groups/{group_id}/options",
    response_model=ProductVariantOptionOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增變體選項",
)
async def add_variant_option(
    group_id: uuid.UUID,
    payload: ProductVariantOptionCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantOption:
    group = await _get_variant_group_or_404(group_id, session)
    await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    return await shop_svc.add_variant_option(session, group, data=payload)


@router.patch(
    "/variant-options/{option_id}",
    response_model=ProductVariantOptionOut,
    summary="更新變體選項",
)
async def update_variant_option(
    option_id: uuid.UUID,
    payload: ProductVariantOptionUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> ProductVariantOption:
    option = await _get_variant_option_or_404(option_id, session)
    group = await _get_variant_group_or_404(option.group_id, session)
    await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    try:
        return await shop_svc.update_variant_option(session, option, data=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete(
    "/variant-options/{option_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除變體選項",
)
async def delete_variant_option(
    option_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> None:
    option = await _get_variant_option_or_404(option_id, session)
    group = await _get_variant_group_or_404(option.group_id, session)
    await _get_product_or_404(group.product_id, session, current_user)
    await _require_shop_manager(session, current_user)
    await shop_svc.delete_variant_option(session, option)
