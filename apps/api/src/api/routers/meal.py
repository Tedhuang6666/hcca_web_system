"""學餐訂購系統 Router - 商家 / 菜單排程 / 品項 / 訂單 / 報表匯出"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.meal import MealOrder, MealVendor, MenuItem, MenuSchedule
from api.models.user import User
from api.schemas.meal import (
    ItemStatOut,
    MealAvailabilityCreate,
    MealAvailabilityOut,
    MealClassPickupCodeOut,
    MealOrderCancelRequest,
    MealOrderCreate,
    MealOrderListItem,
    MealOrderOut,
    MealPickupLookupOut,
    MealProductCreate,
    MealProductOut,
    MealProductUpdate,
    MealVendorApplicationCreate,
    MealVendorApplicationOut,
    MealVendorApplicationReview,
    MealVendorCreate,
    MealVendorOut,
    MealVendorUpdate,
    MealWeeklyAvailabilityCreate,
    MenuItemCreate,
    MenuItemOut,
    MenuItemUpdate,
    MenuScheduleCreate,
    MenuScheduleListItem,
    MenuScheduleOut,
    MenuScheduleUpdate,
    PickupListItemOut,
    VendorManagerAssignRequest,
    VendorManagerOut,
)
from api.schemas.shop import ImageUploadOut
from api.services import audit as audit_svc
from api.services import meal as meal_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/meal", tags=["學餐訂購系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
MealManagerUser = Annotated[User, Depends(require_permission(PermissionCode.MEAL_MANAGE))]


# ── 輔助 ──────────────────────────────────────────────────────────────────────


async def _get_user_org_ids(session: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """取得使用者目前有效任期所屬的所有組織 ID（用於 IDOR 防護）"""
    from datetime import date as date_type

    from api.models.org import Position, UserPosition

    today = date_type.today()
    result = await session.execute(
        select(Position.org_id)
        .join(UserPosition, UserPosition.position_id == Position.id)
        .where(UserPosition.user_id == user_id)
        .where(UserPosition.start_date <= today)
        .where((UserPosition.end_date.is_(None)) | (UserPosition.end_date >= today))
        .distinct()
    )
    return {row[0] for row in result.all()}


async def _vendor_or_404(vendor_id: uuid.UUID, session: DbDep) -> MealVendor:
    v = await meal_svc.get_vendor(session, vendor_id)
    if v is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商家")
    return v


async def _require_vendor_manager(
    session: AsyncSession, vendor_id: uuid.UUID, user: User
) -> None:
    if user.is_superuser:
        return
    from api.services.permission import get_user_permission_codes

    codes = await get_user_permission_codes(session, user.id)
    if PermissionCode.ADMIN_ALL in codes or PermissionCode.MEAL_MANAGE in codes:
        return
    if await meal_svc.is_vendor_manager(session, vendor_id, user.id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權管理此商家")


async def _schedule_or_404(schedule_id: uuid.UUID, session: DbDep) -> MenuSchedule:
    s = await meal_svc.get_schedule(session, schedule_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此菜單排程")
    return s


async def _item_or_404(item_id: uuid.UUID, session: DbDep) -> MenuItem:
    i = await meal_svc.get_menu_item(session, item_id)
    if i is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此菜單品項")
    return i


async def _order_or_404(order_id: uuid.UUID, session: DbDep) -> MealOrder:
    o = await meal_svc.get_meal_order(session, order_id)
    if o is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此學餐訂單")
    return o


# ══════════════════════════════════════════════════════════════════════════════
# 商家端點（meal:manage 才能新增/修改）
# ══════════════════════════════════════════════════════════════════════════════


@router.post(
    "/images",
    response_model=ImageUploadOut,
    summary="上傳學餐商品圖片（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def upload_meal_image(_: CurrentUser, file: UploadFile = File(...)) -> ImageUploadOut:
    storage = get_storage()
    try:
        stored = await storage.save(file, prefix="meal")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    return ImageUploadOut(url=stored.url)


@router.get("/vendors", response_model=list[MealVendorOut], summary="列出商家")
async def list_vendors(
    session: DbDep,
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織"),
    active_only: bool = Query(True, description="僅顯示啟用中的商家"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[MealVendor]:
    return await meal_svc.list_vendors(
        session, org_id=org_id, active_only=active_only, limit=limit, offset=offset
    )


@router.post(
    "/vendor-applications",
    response_model=MealVendorApplicationOut,
    status_code=status.HTTP_201_CREATED,
    summary="送出店家入駐申請",
)
async def create_vendor_application(
    payload: MealVendorApplicationCreate, session: DbDep, _: CurrentUser
) -> object:
    return await meal_svc.create_vendor_application(session, data=payload)


@router.get(
    "/vendor-applications",
    response_model=list[MealVendorApplicationOut],
    summary="列出店家入駐申請（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def list_vendor_applications(
    session: DbDep,
    _: CurrentUser,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list:
    return await meal_svc.list_vendor_applications(
        session, status=status_filter, limit=limit, offset=offset
    )


@router.post(
    "/vendor-applications/{application_id}/review",
    response_model=MealVendorApplicationOut,
    summary="審核店家入駐申請（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def review_vendor_application(
    application_id: uuid.UUID,
    payload: MealVendorApplicationReview,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    app = await meal_svc.get_vendor_application(session, application_id)
    if app is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此申請")
    try:
        return await meal_svc.review_vendor_application(
            session, app, data=payload, reviewer_id=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.get("/vendors/{vendor_id}", response_model=MealVendorOut, summary="取得商家詳細")
async def get_vendor(vendor_id: uuid.UUID, session: DbDep, _: CurrentUser) -> MealVendor:
    return await _vendor_or_404(vendor_id, session)


@router.post(
    "/vendors",
    response_model=MealVendorOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增商家（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def create_vendor(
    payload: MealVendorCreate, session: DbDep, current_user: CurrentUser
) -> MealVendor:
    try:
        vendor = await meal_svc.create_vendor(session, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="meal_vendor",
        entity_id=str(vendor.id),
        action="meal.vendor_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "org_id": str(vendor.org_id),
            "name": vendor.name,
            "manager_email": str(payload.manager_email) if payload.manager_email else None,
        },
        summary=f"建立學餐商家「{vendor.name}」",
    )
    return vendor


@router.patch(
    "/vendors/{vendor_id}",
    response_model=MealVendorOut,
    summary="更新商家資料（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def update_vendor(
    vendor_id: uuid.UUID,
    payload: MealVendorUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MealVendor:
    vendor = await _vendor_or_404(vendor_id, session)
    before = {
        "name": vendor.name,
        "is_active": vendor.is_active,
        "contact_phone": vendor.contact_phone,
        "contact_email": vendor.contact_email,
    }
    vendor = await meal_svc.update_vendor(session, vendor, data=payload)
    await audit_svc.record(
        session,
        entity_type="meal_vendor",
        entity_id=str(vendor.id),
        action="meal.vendor_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": vendor.name,
                "is_active": vendor.is_active,
                "contact_phone": vendor.contact_phone,
                "contact_email": vendor.contact_email,
            },
        },
        summary=f"更新學餐商家「{vendor.name}」",
    )
    return vendor


@router.post(
    "/vendors/{vendor_id}/managers",
    response_model=VendorManagerOut,
    status_code=status.HTTP_201_CREATED,
    summary="指派商家管理員（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def assign_vendor_manager(
    vendor_id: uuid.UUID,
    payload: VendorManagerAssignRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> dict:
    vendor = await _vendor_or_404(vendor_id, session)
    try:
        manager = await meal_svc.assign_vendor_manager(session, vendor, payload.email)
    except ValueError as e:
        # B3: 統一回傳 400 避免 email 枚舉攻擊（不洩漏 email 是否存在）
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="操作失敗，請確認 Email 是否正確",
        ) from e
    await audit_svc.record(
        session,
        entity_type="meal_vendor",
        entity_id=str(vendor.id),
        action="meal.vendor_manager_assign",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"vendor_name": vendor.name, "manager_email": payload.email, **manager},
        summary=f"指派學餐商家「{vendor.name}」管理員",
    )
    return manager


@router.get(
    "/vendors/{vendor_id}/managers",
    response_model=list[VendorManagerOut],
    summary="列出商家管理人",
)
async def list_vendor_managers(
    vendor_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> list[dict]:
    await _require_vendor_manager(session, vendor_id, current_user)
    managers = await meal_svc.list_vendor_managers(session, vendor_id)
    return [
        {
            "user_id": manager.user_id,
            "display_name": manager.user.display_name if manager.user else "",
            "email": manager.user.email if manager.user else "",
            "position_id": manager.position_id,
            "user_position_id": manager.user_position_id,
        }
        for manager in managers
    ]


@router.delete(
    "/vendors/{vendor_id}/managers/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除商家管理人（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def remove_vendor_manager(
    vendor_id: uuid.UUID, user_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> None:
    if not await meal_svc.remove_vendor_manager(session, vendor_id, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此管理人")


@router.get("/products", response_model=list[MealProductOut], summary="列出學餐商品")
async def list_products(
    session: DbDep,
    _: CurrentUser,
    vendor_id: uuid.UUID | None = Query(None),
    active_only: bool = Query(True),
    limit: int = Query(100, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list:
    return await meal_svc.list_products(
        session, vendor_id=vendor_id, active_only=active_only, limit=limit, offset=offset
    )


@router.post(
    "/products",
    response_model=MealProductOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立商家商品",
)
async def create_product(
    payload: MealProductCreate, session: DbDep, current_user: CurrentUser
) -> object:
    await _require_vendor_manager(session, payload.vendor_id, current_user)
    try:
        return await meal_svc.create_product(session, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


@router.patch("/products/{product_id}", response_model=MealProductOut, summary="更新商家商品")
async def update_product(
    product_id: uuid.UUID,
    payload: MealProductUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    product = await meal_svc.get_product(session, product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    await _require_vendor_manager(session, product.vendor_id, current_user)
    return await meal_svc.update_product(session, product, data=payload)


@router.get(
    "/availabilities",
    response_model=list[MealAvailabilityOut],
    summary="列出商品上架",
)
async def list_availabilities(
    session: DbDep,
    _: CurrentUser,
    vendor_id: uuid.UUID | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    active_only: bool = Query(True),
    limit: int = Query(100, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list:
    return await meal_svc.list_availabilities(
        session,
        vendor_id=vendor_id,
        date_from=date_from,
        date_to=date_to,
        active_only=active_only,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/availabilities",
    response_model=MealAvailabilityOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立商品上架與取餐時段",
)
async def create_availability(
    payload: MealAvailabilityCreate, session: DbDep, current_user: CurrentUser
) -> object:
    product = await meal_svc.get_product(session, payload.product_id)
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    await _require_vendor_manager(session, product.vendor_id, current_user)
    try:
        return await meal_svc.create_availability(session, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


@router.post(
    "/availabilities/weekly",
    response_model=list[MealAvailabilityOut],
    status_code=status.HTTP_201_CREATED,
    summary="批次建立整週商品上架",
)
async def bulk_create_weekly_availabilities(
    payload: MealWeeklyAvailabilityCreate, session: DbDep, current_user: CurrentUser
) -> list:
    first_product = await meal_svc.get_product(session, payload.product_ids[0])
    if first_product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此商品")
    await _require_vendor_manager(session, first_product.vendor_id, current_user)
    try:
        return await meal_svc.bulk_create_weekly_availabilities(session, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e


# ══════════════════════════════════════════════════════════════════════════════
# 菜單排程端點
# ══════════════════════════════════════════════════════════════════════════════


@router.get("/schedules", response_model=list[MenuScheduleListItem], summary="列出菜單排程")
async def list_schedules(
    session: DbDep,
    _: CurrentUser,
    vendor_id: uuid.UUID | None = Query(None),
    date_from: date | None = Query(None, description="服務日期起（YYYY-MM-DD）"),
    date_to: date | None = Query(None, description="服務日期迄（YYYY-MM-DD）"),
    is_closed: bool | None = Query(None, description="True=已結單 / False=開放中"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[MenuSchedule]:
    return await meal_svc.list_schedules(
        session,
        vendor_id=vendor_id,
        date_from=date_from,
        date_to=date_to,
        is_closed=is_closed,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/schedules/{schedule_id}",
    response_model=MenuScheduleOut,
    summary="取得排程詳細（含菜單品項）",
)
async def get_schedule(schedule_id: uuid.UUID, session: DbDep, _: CurrentUser) -> MenuSchedule:
    return await _schedule_or_404(schedule_id, session)


@router.post(
    "/schedules",
    response_model=MenuScheduleOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立菜單排程（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def create_schedule(
    payload: MenuScheduleCreate, session: DbDep, current_user: CurrentUser
) -> MenuSchedule:
    try:
        schedule = await meal_svc.create_schedule(session, data=payload, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此商家在該日期已有菜單排程",
        ) from e
    # 重新載入以包含 items（空陣列）
    schedule = await _schedule_or_404(schedule.id, session)
    await audit_svc.record(
        session,
        entity_type="meal_schedule",
        entity_id=str(schedule.id),
        action="meal.schedule_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "vendor_id": str(schedule.vendor_id),
            "date": schedule.date.isoformat(),
            "order_deadline": schedule.order_deadline.isoformat(),
        },
        summary=f"建立學餐排程「{schedule.date.isoformat()}」",
    )
    return schedule


@router.patch(
    "/schedules/{schedule_id}",
    response_model=MenuScheduleOut,
    summary="更新排程（meal:manage，結單前可改）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def update_schedule(
    schedule_id: uuid.UUID,
    payload: MenuScheduleUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MenuSchedule:
    schedule = await _schedule_or_404(schedule_id, session)
    before = {
        "order_open_time": schedule.order_open_time.isoformat()
        if schedule.order_open_time
        else None,
        "order_deadline": schedule.order_deadline.isoformat(),
        "note": schedule.note,
        "is_closed": schedule.is_closed,
    }
    try:
        schedule = await meal_svc.update_schedule(session, schedule, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="meal_schedule",
        entity_id=str(schedule.id),
        action="meal.schedule_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "order_open_time": (
                    schedule.order_open_time.isoformat() if schedule.order_open_time else None
                ),
                "order_deadline": schedule.order_deadline.isoformat(),
                "note": schedule.note,
                "is_closed": schedule.is_closed,
            },
        },
        summary=f"更新學餐排程「{schedule.date.isoformat()}」",
    )
    return schedule


@router.post(
    "/schedules/{schedule_id}/close",
    response_model=MenuScheduleOut,
    summary="手動結單（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def close_schedule(
    schedule_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> MenuSchedule:
    schedule = await _schedule_or_404(schedule_id, session)
    try:
        schedule = await meal_svc.close_schedule(session, schedule)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="meal_schedule",
        entity_id=str(schedule.id),
        action="meal.schedule_close",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"date": schedule.date.isoformat(), "is_closed": schedule.is_closed},
        summary=f"手動結單學餐排程「{schedule.date.isoformat()}」",
    )
    return schedule


@router.get(
    "/schedules/{schedule_id}/item-stats",
    response_model=list[ItemStatOut],
    summary="取得排程品項訂購統計（供熱門排序）",
)
async def get_schedule_item_stats(
    schedule_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> list[dict]:
    return await meal_svc.get_schedule_item_stats(session, schedule_id)


@router.get(
    "/schedules/{schedule_id}/pickup-list",
    response_model=list[PickupListItemOut],
    summary="取得排程領餐名單（meal:manage，限本組織）",
)
async def get_schedule_pickup_list(
    schedule_id: uuid.UUID, session: DbDep, current_user: MealManagerUser
) -> list[dict]:
    # B1: IDOR 防護 — 確認排程所屬商家的組織與操作者一致
    schedule = await _schedule_or_404(schedule_id, session)
    if not current_user.is_superuser:
        vendor = await _vendor_or_404(schedule.vendor_id, session)
        user_org_ids = await _get_user_org_ids(session, current_user.id)
        if vendor.org_id not in user_org_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權限存取此排程")
    return await meal_svc.get_schedule_pickup_list(session, schedule_id)


# ══════════════════════════════════════════════════════════════════════════════
# 菜單品項端點
# ══════════════════════════════════════════════════════════════════════════════


@router.post(
    "/schedules/{schedule_id}/items",
    response_model=MenuItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增菜單品項（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def add_menu_item(
    schedule_id: uuid.UUID,
    payload: MenuItemCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> MenuItem:
    schedule = await _schedule_or_404(schedule_id, session)
    try:
        item = await meal_svc.add_menu_item(session, schedule, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="meal_item",
        entity_id=str(item.id),
        action="meal.item_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"schedule_id": str(schedule.id), "name": item.name, "price": item.price},
        summary=f"新增學餐品項「{item.name}」",
    )
    return item


@router.patch(
    "/items/{item_id}",
    response_model=MenuItemOut,
    summary="更新菜單品項（meal:manage）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def update_menu_item(
    item_id: uuid.UUID,
    payload: MenuItemUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> MenuItem:
    item = await _item_or_404(item_id, session)
    before = {
        "name": item.name,
        "price": item.price,
        "max_quantity": item.max_quantity,
        "is_available": item.is_available,
    }
    try:
        item = await meal_svc.update_menu_item(session, item, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="meal_item",
        entity_id=str(item.id),
        action="meal.item_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": item.name,
                "price": item.price,
                "max_quantity": item.max_quantity,
                "is_available": item.is_available,
            },
        },
        summary=f"更新學餐品項「{item.name}」",
    )
    return item


@router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除菜單品項（meal:manage，無訂單時才能刪）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def delete_menu_item(item_id: uuid.UUID, session: DbDep, current_user: CurrentUser) -> None:
    item = await _item_or_404(item_id, session)
    meta = {"schedule_id": str(item.schedule_id), "name": item.name, "price": item.price}
    try:
        await meal_svc.delete_menu_item(session, item)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="meal_item",
        entity_id=str(item_id),
        action="meal.item_delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=meta,
        summary=f"刪除學餐品項「{meta['name']}」",
    )


# ══════════════════════════════════════════════════════════════════════════════
# 學生：學餐訂單端點
# ══════════════════════════════════════════════════════════════════════════════


@router.post(
    "/orders",
    response_model=MealOrderOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立學餐訂單（任何已登入使用者）",
)
async def create_meal_order(
    payload: MealOrderCreate, session: DbDep, current_user: CurrentUser
) -> MealOrder:
    try:
        order = await meal_svc.create_meal_order(session, user_id=current_user.id, data=payload)
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="您已對此排程下單，每人每日限訂一次",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    except RuntimeError as e:
        # B5: pickup_code 碰撞耗盡（極低機率）
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="系統繁忙，請稍後再試",
        ) from e
    # 重新載入含明細的訂單
    order = await _order_or_404(order.id, session)
    await audit_svc.record(
        session,
        entity_type="meal_order",
        entity_id=str(order.id),
        action="meal.order_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "serial_number": order.serial_number,
            "schedule_id": str(order.schedule_id),
            "vendor_id": str(order.vendor_id),
            "total_price": order.total_price,
        },
        summary=f"建立學餐訂單「{order.serial_number}」",
    )
    return order


@router.get(
    "/orders",
    response_model=list[MealOrderListItem],
    summary="列出學餐訂單（my_only=True 只看自己；meal:manage 可查全部）",
)
async def list_meal_orders(
    session: DbDep,
    current_user: CurrentUser,
    my_only: bool = Query(True, description="僅顯示我的訂單"),
    schedule_id: uuid.UUID | None = Query(None),
    vendor_id: uuid.UUID | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[MealOrder]:
    # 無 meal:manage 的使用者強制只能看自己的訂單
    effective_user_id: uuid.UUID | None
    if my_only:
        effective_user_id = current_user.id
    else:
        # 嘗試取得管理員權限；若無則降級為 my_only
        from api.services.permission import get_user_permission_codes

        codes = await get_user_permission_codes(session, current_user.id)
        if "meal:manage" in codes or current_user.is_superuser:
            effective_user_id = None
        else:
            effective_user_id = current_user.id

    # meal:manage 查全站時，必須限制在可管理範圍內（避免全站 PII）
    if effective_user_id is None and not current_user.is_superuser:
        if schedule_id is None and vendor_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="管理查詢必須指定 vendor_id 或 schedule_id",
            )
        if schedule_id is not None and vendor_id is None:
            schedule = await _schedule_or_404(schedule_id, session)
            vendor_id = schedule.vendor_id
        if vendor_id is not None:
            vendor = await _vendor_or_404(vendor_id, session)
            user_org_ids = await _get_user_org_ids(session, current_user.id)
            if vendor.org_id not in user_org_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="無權限存取此商家"
                )

    return await meal_svc.list_meal_orders(
        session,
        user_id=effective_user_id,
        schedule_id=schedule_id,
        vendor_id=vendor_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/orders/class",
    response_model=list[MealOrderListItem],
    summary="午餐股長查看本班學餐訂單",
)
async def list_class_meal_orders(
    session: DbDep,
    current_user: CurrentUser,
    vendor_id: uuid.UUID | None = Query(None),
    pickup_slot_id: uuid.UUID | None = Query(None),
    is_paid: bool | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list:
    from api.services import school_class as class_svc

    class_ids = list(await class_svc.get_cadre_class_ids(session, current_user.id))
    return await meal_svc.list_class_meal_orders(
        session,
        class_ids=class_ids,
        vendor_id=vendor_id,
        pickup_slot_id=pickup_slot_id,
        is_paid=is_paid,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/orders/{order_id}/payment",
    response_model=MealOrderOut,
    summary="午餐股長標示本班學餐收款",
)
async def update_meal_order_payment(
    order_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    is_paid: bool = Query(...),
) -> MealOrder:
    from api.services import school_class as class_svc

    order = await _order_or_404(order_id, session)
    class_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not current_user.is_superuser and order.class_id not in class_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權標示此訂單收款")
    return await meal_svc.set_order_paid(
        session, order, is_paid=is_paid, actor_id=current_user.id
    )


@router.post(
    "/orders/class-pickup-code",
    response_model=MealClassPickupCodeOut,
    summary="午餐股長取得同班同商家同時段整班隨機領取碼",
)
async def get_class_pickup_code(
    session: DbDep,
    current_user: CurrentUser,
    class_id: uuid.UUID = Query(...),
    vendor_id: uuid.UUID = Query(...),
    pickup_slot_id: uuid.UUID = Query(...),
) -> dict:
    from api.services import school_class as class_svc

    class_ids = await class_svc.get_cadre_class_ids(session, current_user.id)
    if not current_user.is_superuser and class_id not in class_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權取得此班領取碼")
    return await meal_svc.get_or_create_class_pickup_code(
        session,
        class_id=class_id,
        vendor_id=vendor_id,
        pickup_slot_id=pickup_slot_id,
        issued_to_id=current_user.id,
    )


@router.get(
    "/orders/lookup",
    response_model=MealOrderOut,
    summary="以取餐代碼（5 碼）或字號查詢訂單（meal:manage，核銷用）",
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def lookup_order(
    session: DbDep,
    current_user: MealManagerUser,
    code: str = Query(..., description="5 位取餐代碼或完整訂單字號"),
) -> MealOrder:
    # 優先嘗試 pickup_code（純數字 5 位），再嘗試 serial_number
    order: MealOrder | None = None
    if code.isdigit() and len(code) == 5:
        order = await meal_svc.get_order_by_pickup_code(session, code)
    if order is None:
        order = await meal_svc.get_order_by_serial(session, code)
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此代碼或字號")
    if not current_user.is_superuser:
        vendor = await _vendor_or_404(order.vendor_id, session)
        user_org_ids = await _get_user_org_ids(session, current_user.id)
        if vendor.org_id not in user_org_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權限存取此訂單")
    return order


@router.post(
    "/pickup/lookup",
    response_model=MealPickupLookupOut,
    summary="商家輸入個人五碼或班級隨機碼核銷",
)
async def pickup_lookup(
    session: DbDep,
    current_user: MealManagerUser,
    code: str = Query(...),
    redeem: bool = Query(True),
) -> dict:
    try:
        return await meal_svc.lookup_and_redeem_pickup_code(
            session, code=code, actor_id=current_user.id, redeem=redeem
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


@router.get(
    "/orders/{order_id}",
    response_model=MealOrderOut,
    summary="取得學餐訂單詳細",
)
async def get_meal_order(
    order_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> MealOrder:
    order = await _order_or_404(order_id, session)
    # 非本人且非管理員不能查看他人訂單
    if order.user_id != current_user.id and not current_user.is_superuser:
        from api.services.permission import get_user_permission_codes

        codes = await get_user_permission_codes(session, current_user.id)
        if "meal:manage" not in codes:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權查看此訂單")
    return order


@router.post(
    "/orders/{order_id}/cancel",
    response_model=MealOrderOut,
    summary="取消學餐訂單（訂購人，結單前可取消）",
)
async def cancel_meal_order(
    order_id: uuid.UUID,
    payload: MealOrderCancelRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> MealOrder:
    order = await _order_or_404(order_id, session)
    try:
        await meal_svc.cancel_meal_order(
            session, order, requested_by=current_user.id, reason=payload.reason
        )
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    order = await _order_or_404(order.id, session)
    await audit_svc.record(
        session,
        entity_type="meal_order",
        entity_id=str(order.id),
        action="meal.order_cancel",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "reason": payload.reason},
        summary=f"取消學餐訂單「{order.serial_number}」",
    )
    return order


# ── 商家：訂單管理端點 ────────────────────────────────────────────────────────


@router.post(
    "/orders/{order_id}/confirm",
    response_model=MealOrderOut,
    summary="確認學餐訂單（meal:manage，限本組織）",
)
async def confirm_meal_order(
    order_id: uuid.UUID, session: DbDep, current_user: MealManagerUser
) -> MealOrder:
    order = await _order_or_404(order_id, session)
    # B2: IDOR 防護 — 確認訂單所屬商家的組織與操作者一致
    if not current_user.is_superuser:
        vendor = await _vendor_or_404(order.vendor_id, session)
        user_org_ids = await _get_user_org_ids(session, current_user.id)
        if vendor.org_id not in user_org_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權限操作此訂單")
    try:
        await meal_svc.confirm_meal_order(session, order)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    order = await _order_or_404(order.id, session)
    await audit_svc.record(
        session,
        entity_type="meal_order",
        entity_id=str(order.id),
        action="meal.order_confirm",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "status": order.status.value},
        summary=f"確認學餐訂單「{order.serial_number}」",
    )
    return order


@router.post(
    "/orders/{order_id}/complete",
    response_model=MealOrderOut,
    summary="完成學餐訂單（meal:manage，限本組織）",
)
async def complete_meal_order(
    order_id: uuid.UUID, session: DbDep, current_user: MealManagerUser
) -> MealOrder:
    order = await _order_or_404(order_id, session)
    # B2: IDOR 防護 — 確認訂單所屬商家的組織與操作者一致
    if not current_user.is_superuser:
        vendor = await _vendor_or_404(order.vendor_id, session)
        user_org_ids = await _get_user_org_ids(session, current_user.id)
        if vendor.org_id not in user_org_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="無權限操作此訂單")
    try:
        await meal_svc.complete_meal_order(session, order)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    order = await _order_or_404(order.id, session)
    await audit_svc.record(
        session,
        entity_type="meal_order",
        entity_id=str(order.id),
        action="meal.order_complete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"serial_number": order.serial_number, "status": order.status.value},
        summary=f"完成學餐訂單「{order.serial_number}」",
    )
    return order


# ══════════════════════════════════════════════════════════════════════════════
# 報表匯出（meal:manage）
# ══════════════════════════════════════════════════════════════════════════════


@router.get(
    "/reports/orders.xlsx",
    response_class=Response,
    summary="匯出學餐訂單報表（Excel，meal:manage）",
    responses={
        200: {"content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}}}
    },
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def export_meal_orders_excel(
    session: DbDep,
    current_user: CurrentUser,
    vendor_id: uuid.UUID | None = Query(None, description="過濾商家"),
    schedule_id: uuid.UUID | None = Query(None, description="過濾排程"),
) -> Response:
    if not current_user.is_superuser:
        if schedule_id is None and vendor_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="匯出報表必須指定 vendor_id 或 schedule_id",
            )
        if schedule_id is not None and vendor_id is None:
            schedule = await _schedule_or_404(schedule_id, session)
            vendor_id = schedule.vendor_id
        if vendor_id is not None:
            vendor = await _vendor_or_404(vendor_id, session)
            user_org_ids = await _get_user_org_ids(session, current_user.id)
            if vendor.org_id not in user_org_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="無權限匯出此商家報表"
                )
    xlsx_bytes = await meal_svc.export_meal_orders_excel(
        session, vendor_id=vendor_id, schedule_id=schedule_id
    )
    filename = f"meal_orders_{__import__('datetime').date.today()}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/reports/orders.csv",
    response_class=Response,
    summary="匯出學餐訂單報表（CSV，meal:manage）",
    responses={200: {"content": {"text/csv": {}}}},
    dependencies=[Depends(require_permission(PermissionCode.MEAL_MANAGE))],
)
async def export_meal_orders_csv(
    session: DbDep,
    current_user: CurrentUser,
    vendor_id: uuid.UUID | None = Query(None),
    schedule_id: uuid.UUID | None = Query(None),
) -> Response:
    if not current_user.is_superuser:
        if schedule_id is None and vendor_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="匯出報表必須指定 vendor_id 或 schedule_id",
            )
        if schedule_id is not None and vendor_id is None:
            schedule = await _schedule_or_404(schedule_id, session)
            vendor_id = schedule.vendor_id
        if vendor_id is not None:
            vendor = await _vendor_or_404(vendor_id, session)
            user_org_ids = await _get_user_org_ids(session, current_user.id)
            if vendor.org_id not in user_org_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="無權限匯出此商家報表"
                )
    csv_str = await meal_svc.export_meal_orders_csv(
        session, vendor_id=vendor_id, schedule_id=schedule_id
    )
    filename = f"meal_orders_{__import__('datetime').date.today()}.csv"
    return Response(
        content=csv_str.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
