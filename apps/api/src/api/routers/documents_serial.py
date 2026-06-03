"""公文範本庫 (`/document-templates`) 與字號模板 (`/document-serial-templates`) 端點。

從 [routers/documents.py](apps/api/src/api/routers/documents.py) 提取。共用
[documents_helpers.py](apps/api/src/api/routers/documents_helpers.py) 中的範本
權限守衛。各 sub-router 由 [api/__init__.py](apps/api/src/api/__init__.py) 直接
掛載（template_router / serial_router 對外保持原 URL 不變）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.models.document import Document, DocumentCategory
from api.models.user import User
from api.routers.documents_helpers import (
    org_ids_with_document_permissions,
    require_document_template_manage,
    require_document_template_use,
)
from api.schemas.document import (
    DocumentOut,
    DocumentTemplateCreate,
    DocumentTemplateDraftCreate,
    DocumentTemplateOut,
    DocumentTemplateUpdate,
    SerialTemplateCreate,
    SerialTemplateOut,
    SerialTemplateUpdate,
)
from api.services import audit as audit_svc
from api.services import document as doc_svc
from api.services.permission import (
    get_user_permission_codes,
    get_user_permission_codes_for_org,
)

template_router = APIRouter(prefix="/document-templates", tags=["公文範本庫"])
serial_router = APIRouter(prefix="/document-serial-templates", tags=["字號模板（doc.issue）"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── 公文範本庫 ────────────────────────────────────────────────────────────────


@template_router.get("", response_model=list[DocumentTemplateOut], summary="列出公文內容範本")
async def list_document_templates(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織"),
    category: DocumentCategory | None = Query(None, description="過濾公文類別"),
    active_only: bool = Query(True, description="僅顯示有效範本"),
    keyword: str | None = Query(None, max_length=100, description="搜尋名稱、說明、主旨"),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[object]:
    if org_id is not None:
        await require_document_template_use(session, current_user, org_id)
        org_ids = None
    elif current_user.is_superuser:
        org_ids = None
    else:
        org_ids = await org_ids_with_document_permissions(session, current_user)
    return await doc_svc.list_document_templates(
        session,
        org_id=org_id,
        org_ids=org_ids,
        category=category,
        active_only=active_only,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@template_router.post(
    "",
    response_model=DocumentTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立公文內容範本",
)
async def create_document_template(
    payload: DocumentTemplateCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    await require_document_template_manage(session, current_user, payload.org_id)
    try:
        template = await doc_svc.create_document_template(
            session,
            data=payload,
            created_by=current_user.id,
        )
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="同組織內已有同名同版本公文範本",
        ) from exc
    await audit_svc.record(
        session,
        entity_type="document_template",
        entity_id=str(template.id),
        action="document_template.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(template.org_id), "category": template.category.value},
        summary=f"建立公文範本「{template.name}」",
    )
    return template


@template_router.get(
    "/{template_id}", response_model=DocumentTemplateOut, summary="取得公文內容範本"
)
async def get_document_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文範本")
    await require_document_template_use(session, current_user, template.org_id)
    return template


@template_router.patch(
    "/{template_id}",
    response_model=DocumentTemplateOut,
    summary="更新公文內容範本",
)
async def update_document_template(
    template_id: uuid.UUID,
    payload: DocumentTemplateUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文範本")
    await require_document_template_manage(session, current_user, template.org_id)
    before = {
        "name": template.name,
        "version": template.version,
        "is_active": template.is_active,
        "category": template.category.value,
    }
    template = await doc_svc.update_document_template(
        session,
        template,
        data=payload,
        updated_by=current_user.id,
    )
    await audit_svc.record(
        session,
        entity_type="document_template",
        entity_id=str(template.id),
        action="document_template.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "name": template.name,
                "version": template.version,
                "is_active": template.is_active,
                "category": template.category.value,
            },
        },
        summary=f"更新公文範本「{template.name}」",
    )
    return template


@template_router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="停用公文內容範本",
)
async def deactivate_document_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此公文範本")
    await require_document_template_manage(session, current_user, template.org_id)
    await doc_svc.deactivate_document_template(session, template, updated_by=current_user.id)
    await audit_svc.record(
        session,
        entity_type="document_template",
        entity_id=str(template.id),
        action="document_template.deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"org_id": str(template.org_id), "version": template.version},
        summary=f"停用公文範本「{template.name}」",
    )


@template_router.post(
    "/{template_id}/draft",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="從公文範本建立草稿",
)
async def create_document_from_template(
    template_id: uuid.UUID,
    payload: DocumentTemplateDraftCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> Document:
    template = await doc_svc.get_document_template(session, template_id)
    if template is None or not template.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此可用公文範本")
    await require_document_template_use(session, current_user, template.org_id)
    try:
        doc = await doc_svc.create_document_from_template(
            session,
            template=template,
            data=payload,
            created_by=current_user.id,
        )
    except (PermissionError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    await audit_svc.record(
        session,
        entity_type="document",
        entity_id=str(doc.id),
        action="document.create_from_template",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"template_id": str(template.id), "template_name": template.name},
        summary=f"由範本「{template.name}」建立公文「{doc.title}」",
    )
    return doc


# ── 字號模板 (doc.issue) ──────────────────────────────────────────────────────


@serial_router.post(
    "",
    response_model=SerialTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立字號模板（需 serial:create 或 admin:all，限本組織）",
    responses={
        201: {"description": "字號模板建立成功，字號格式如：嶺代生字第 1150000001 號"},
        403: {"description": "需要 serial:create 或 admin:all 權限（限本組織）"},
        409: {"description": "相同 org_prefix + category_char 組合已存在"},
    },
)
async def create_serial_template(
    payload: SerialTemplateCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    """
    在本組織下建立字號模板，需擁有 `serial:create` 或 `admin:all` 權限（org-scoped）。
    一個 org_prefix + category_char 組合只能建立一個模板（UniqueConstraint）。
    """
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, payload.org_id)
        if "serial:create" not in codes and "admin:all" not in codes:
            global_codes = await get_user_permission_codes(session, current_user.id)
            if "admin:all" not in global_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您在此組織下無新增字號模板的權限（需 serial:create 或 admin:all）",
                )

    try:
        template = await doc_svc.create_serial_template(
            session, data=payload, created_by=current_user.id
        )
        await audit_svc.record(
            session,
            entity_type="serial_template",
            entity_id=str(template.id),
            action="serial.create",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={
                "org_id": str(template.org_id),
                "org_prefix": template.org_prefix,
                "category_char": template.category_char,
                "year_mode": template.year_mode.value,
                "is_default": template.is_default,
                "is_default_president_publish": template.is_default_president_publish,
            },
            summary=f"建立字號模板「{template.org_prefix}{template.category_char}字」",
        )
        if template.is_default:
            await audit_svc.record(
                session,
                entity_type="serial_template",
                entity_id=str(template.id),
                action="serial.set_default",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={"org_id": str(template.org_id), "default_type": "global"},
                summary=f"設為一般預設字號模板「{template.org_prefix}{template.category_char}字」",
            )
        if template.is_default_president_publish:
            await audit_svc.record(
                session,
                entity_type="serial_template",
                entity_id=str(template.id),
                action="serial.set_president_default",
                actor_id=str(current_user.id),
                actor_email=current_user.email,
                meta={"org_id": str(template.org_id), "default_type": "president_publish"},
                summary=f"設為主席公告預設字號模板「{template.org_prefix}{template.category_char}字」",
            )
        return SerialTemplateOut.from_orm_with_preview(template)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="相同的字號前綴組合（org_prefix + category_char）已存在於此組織",
        ) from exc
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@serial_router.get(
    "",
    response_model=list[SerialTemplateOut],
    summary="列出字號模板（依組織過濾）",
)
async def list_serial_templates(
    session: DbDep,
    current_user: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織（不填則顯示所有）"),
    active_only: bool = Query(True, description="僅顯示有效模板"),
) -> list[object]:
    """列出可供選擇的字號模板，進入公文起稿頁面時呼叫此 API 取得下拉選單。"""
    templates = await doc_svc.list_serial_templates(session, org_id=org_id, active_only=active_only)
    return [SerialTemplateOut.from_orm_with_preview(t) for t in templates]


@serial_router.get(
    "/{template_id}",
    response_model=SerialTemplateOut,
    summary="取得字號模板詳細",
    responses={404: {"description": "模板不存在"}},
)
async def get_serial_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    return SerialTemplateOut.from_orm_with_preview(template)


@serial_router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="停用字號模板（需 serial:delete 或 admin:all，限本組織）",
    responses={
        204: {"description": "停用成功"},
        403: {"description": "需要 serial:delete 或 admin:all 權限"},
        404: {"description": "模板不存在"},
    },
)
async def deactivate_serial_template(
    template_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
) -> None:
    """停用字號模板（is_active=False），需在該模板所屬組織下擁有 serial:delete 或 admin:all 權限。"""
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, template.org_id)
        if "serial:delete" not in codes and "admin:all" not in codes:
            global_codes = await get_user_permission_codes(session, current_user.id)
            if "admin:all" not in global_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您在此組織下無停用字號模板的權限（需 serial:delete 或 admin:all）",
                )
    before = {
        "is_active": template.is_active,
        "is_default": template.is_default,
        "is_default_president_publish": template.is_default_president_publish,
    }
    await doc_svc.deactivate_serial_template(session, template)
    await audit_svc.record(
        session,
        entity_type="serial_template",
        entity_id=str(template.id),
        action="serial.deactivate",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "is_active": template.is_active,
                "is_default": template.is_default,
                "is_default_president_publish": template.is_default_president_publish,
            },
            "org_id": str(template.org_id),
            "org_prefix": template.org_prefix,
            "category_char": template.category_char,
        },
        summary=f"停用字號模板「{template.org_prefix}{template.category_char}字」",
    )


@serial_router.patch(
    "/{template_id}",
    response_model=SerialTemplateOut,
    summary="更新字號模板（需 serial:create 或 admin:all，限本組織）",
    responses={
        403: {"description": "需要 serial:create 或 admin:all 權限"},
        404: {"description": "模板不存在"},
    },
)
async def update_serial_template(
    template_id: uuid.UUID,
    payload: SerialTemplateUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> object:
    """更新字號模板的描述、年份制度或重置設定。"""
    template = await doc_svc.get_serial_template(session, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此字號模板")
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, template.org_id)
        if "serial:create" not in codes and "admin:all" not in codes:
            global_codes = await get_user_permission_codes(session, current_user.id)
            if "admin:all" not in global_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您在此組織下無修改字號模板的權限（需 serial:create 或 admin:all）",
                )
    before = {
        "description": template.description,
        "year_mode": template.year_mode.value,
        "reset_on_new_year": template.reset_on_new_year,
        "is_active": template.is_active,
        "is_default": template.is_default,
        "is_default_president_publish": template.is_default_president_publish,
    }
    template = await doc_svc.update_serial_template(
        session,
        template,
        updates=payload.model_dump(exclude_none=True),
    )
    after = {
        "description": template.description,
        "year_mode": template.year_mode.value,
        "reset_on_new_year": template.reset_on_new_year,
        "is_active": template.is_active,
        "is_default": template.is_default,
        "is_default_president_publish": template.is_default_president_publish,
    }
    await audit_svc.record(
        session,
        entity_type="serial_template",
        entity_id=str(template.id),
        action="serial.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": after,
            "org_id": str(template.org_id),
            "org_prefix": template.org_prefix,
            "category_char": template.category_char,
        },
        summary=f"更新字號模板「{template.org_prefix}{template.category_char}字」",
    )
    if not before["is_default"] and template.is_default:
        await audit_svc.record(
            session,
            entity_type="serial_template",
            entity_id=str(template.id),
            action="serial.set_default",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"org_id": str(template.org_id), "default_type": "global"},
            summary=f"設為一般預設字號模板「{template.org_prefix}{template.category_char}字」",
        )
    if not before["is_default_president_publish"] and template.is_default_president_publish:
        await audit_svc.record(
            session,
            entity_type="serial_template",
            entity_id=str(template.id),
            action="serial.set_president_default",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={"org_id": str(template.org_id), "default_type": "president_publish"},
            summary=f"設為主席公告預設字號模板「{template.org_prefix}{template.category_char}字」",
        )
    return SerialTemplateOut.from_orm_with_preview(template)
