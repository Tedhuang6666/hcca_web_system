"""組織預購同步管理；所有來源與診斷僅供商品管理者存取。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_permission
from api.models.shop import ProductCategory
from api.models.shop_sheet import ShopSheetRow, ShopSheetSource
from api.models.user import User
from api.schemas.shop_sheet import (
    ShopSheetEnabledUpdate,
    ShopSheetRowOut,
    ShopSheetSourceCreate,
    ShopSheetSourceOut,
    ShopSheetSyncOut,
)
from api.services import audit
from api.services.shop._sheet_import import sync_source

router = APIRouter(prefix="/shop/sheet-sources", tags=["組織預購匯入"])
Db = Annotated[AsyncSession, Depends(get_db)]
Manager = Annotated[User, Depends(require_permission(PermissionCode.SHOP_MANAGE))]


async def _source(session: AsyncSession, source_id: uuid.UUID) -> ShopSheetSource:
    source = await session.get(ShopSheetSource, source_id)
    if source is None:
        raise HTTPException(404, "找不到此匯入來源")
    return source


@router.get("", response_model=list[ShopSheetSourceOut])
async def list_sources(session: Db, manager: Manager) -> list[ShopSheetSource]:
    return list(await session.scalars(select(ShopSheetSource).order_by(ShopSheetSource.created_at)))


@router.post("", response_model=ShopSheetSourceOut, status_code=201)
async def create_source(
    data: ShopSheetSourceCreate, session: Db, manager: Manager
) -> ShopSheetSource:
    if await session.get(ProductCategory, data.category_id) is None:
        raise HTTPException(422, "找不到商品主題")
    source = ShopSheetSource(**data.model_dump(mode="json"))
    source.category_id = data.category_id
    try:
        async with session.begin_nested():
            session.add(source)
            await session.flush()
    except IntegrityError as exc:
        raise HTTPException(409, "此試算表分頁已經設定匯入來源") from exc
    await audit.record(
        session,
        entity_type="shop_sheet_source",
        entity_id=str(source.id),
        action="shop.sheet_source_create",
        actor_id=str(manager.id),
        summary="新增組織預購同步來源",
    )
    return source


@router.put("/{source_id}", response_model=ShopSheetSourceOut)
async def configure_source(
    source_id: uuid.UUID, data: ShopSheetSourceCreate, session: Db, manager: Manager
) -> ShopSheetSource:
    source = await session.scalar(
        select(ShopSheetSource).where(ShopSheetSource.id == source_id).with_for_update()
    )
    if source is None:
        raise HTTPException(404, "找不到此匯入來源")
    if (data.spreadsheet_id, data.sheet_name, data.config.identity_column) != (
        source.spreadsheet_id,
        source.sheet_name,
        source.config.get("identity_column", "時間戳記"),
    ):
        raise HTTPException(422, "試算表、分頁與識別欄位不可變更；請建立新來源")
    if await session.get(ProductCategory, data.category_id) is None:
        raise HTTPException(422, "找不到商品主題")
    for field, value in data.model_dump(mode="json").items():
        setattr(source, field, data.category_id if field == "category_id" else value)
    await session.flush()
    await audit.record(
        session,
        entity_type="shop_sheet_source",
        entity_id=str(source.id),
        action="shop.sheet_source_update",
        actor_id=str(manager.id),
        summary="更新組織預購同步設定",
    )
    return source


@router.patch("/{source_id}/enabled", response_model=ShopSheetSourceOut)
async def enable_source(
    source_id: uuid.UUID, data: ShopSheetEnabledUpdate, session: Db, manager: Manager
) -> ShopSheetSource:
    source = await session.scalar(
        select(ShopSheetSource).where(ShopSheetSource.id == source_id).with_for_update()
    )
    if source is None:
        raise HTTPException(404, "找不到此匯入來源")
    source.enabled = data.enabled
    await session.flush()
    await audit.record(
        session,
        entity_type="shop_sheet_source",
        entity_id=str(source.id),
        action="shop.sheet_source_enabled",
        actor_id=str(manager.id),
        meta={"enabled": data.enabled},
        summary="切換組織預購自動同步",
    )
    return source


@router.post("/{source_id}/sync", response_model=ShopSheetSyncOut)
async def sync_orders(source_id: uuid.UUID, session: Db, manager: Manager) -> ShopSheetSyncOut:
    await _source(session, source_id)
    result = await sync_source(session, source_id)
    await audit.record(
        session,
        entity_type="shop_sheet_source",
        entity_id=str(source_id),
        action="shop.sheet_sync",
        actor_id=str(manager.id),
        meta=result.model_dump(),
        summary="同步組織預購表單",
    )
    return result


@router.get("/{source_id}/rows", response_model=list[ShopSheetRowOut])
async def list_rows(
    source_id: uuid.UUID,
    session: Db,
    manager: Manager,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
) -> list[ShopSheetRow]:
    await _source(session, source_id)
    return list(
        await session.scalars(
            select(ShopSheetRow)
            .where(ShopSheetRow.source_id == source_id)
            .order_by(ShopSheetRow.row_number)
            .offset(offset)
            .limit(limit)
        )
    )
