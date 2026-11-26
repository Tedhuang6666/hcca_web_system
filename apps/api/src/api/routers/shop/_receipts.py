from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response

from api.core.permission_codes import PermissionCode
from api.dependencies.permissions import require_any
from api.models.school_class import SchoolClass
from api.routers.shop._common import DbDep
from api.schemas.shop import (
    ChangedOrderReceiptCreate,
    ClassOrderConfirmationCreate,
    ClassReceiptBatchCreate,
)
from api.services import shop as shop_svc
from api.services.shop import _lookups as lookups_svc

router = APIRouter()


@router.post(
    "/orders/classes/confirmations.pdf",
    summary="列印各班級訂購總數確認單",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_class_order_confirmations(
    payload: ClassOrderConfirmationCreate, session: DbDep
) -> Response:
    if payload.class_ids is not None:
        found = {row.id for row in await lookups_svc.selected_classes(session, payload.class_ids)}
        if found != set(payload.class_ids):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到指定班級")
    try:
        pdf = await shop_svc.export_class_order_confirmations_pdf(
            session,
            payload.class_ids,
            category_id=payload.category_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename = "班級訂購總數確認單.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/orders/classes/receipts.pdf",
    summary="批次下載班級收款簽收單",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_class_receipts(
    payload: ClassReceiptBatchCreate,
    session: DbDep,
) -> Response:
    school_classes: list[SchoolClass] | None = None
    if payload.class_ids is not None:
        school_classes = await lookups_svc.selected_classes(session, payload.class_ids)
        if len(school_classes) != len(set(payload.class_ids)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到指定班級")
    try:
        pdf = await shop_svc.export_class_receipts_pdf(
            session,
            school_classes,
            category_id=payload.category_id,
            unpaid_only=payload.unpaid_only and school_classes is None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    filename = "班聯收款簽收單-班級.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/orders/receipts/changed.pdf",
    summary="批次列印上次列印後有變更的班級與個人訂單收據",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.SHOP_MANAGE,
                PermissionCode.SHOP_MANAGE_ORDERS,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def download_changed_order_receipts(
    payload: ChangedOrderReceiptCreate,
    session: DbDep,
) -> Response:
    try:
        pdf = await shop_svc.export_changed_order_receipts_pdf(
            session, category_id=payload.category_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote('班聯收款簽收單-增量.pdf', safe='')}"
            ),
            "Cache-Control": "no-store",
        },
    )
