"""
法規系統 Router
==============
RBAC 權限說明（v2 細粒度）：
  - regulation:create  → 建立法規草稿（org-scoped）
  - regulation:edit    → 編輯草稿內容與條文結構（限建立者）
  - regulation:publish → 發布法規（org-scoped）
  - regulation:archive → 停用現行法規（保留歷史）
  - regulation:admin   → 管理員操作（跨組織強制停用）
公開法規（published_at 非 None 且 is_active=True）無需登入即可查詢。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_any, require_permission
from api.models.document import (
    DocumentCategory,
    DocumentClassification,
    DocumentSerialTemplate,
    DocumentUrgency,
)
from api.models.regulation import (
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowLog,
    RegulationWorkflowStatus,
)
from api.models.user import User
from api.schemas.context import RegulationUsageContextOut
from api.schemas.document import DocumentCreate
from api.schemas.regulation import (
    AmendmentComparisonExportRequest,
    AmendmentComparisonRowOut,
    ArticleMoveRequest,
    ArticleReorderRequest,
    AutoRenumberRequest,
    ReferenceWarningOut,
    RegulationArticleCreate,
    RegulationArticleOut,
    RegulationArticleUpdate,
    RegulationCreate,
    RegulationListItem,
    RegulationOut,
    RegulationPublishRequest,
    RegulationRevisionOut,
    RegulationSearchResult,
    RegulationTimeMachineOut,
    RegulationTreeNodeOut,
    RegulationUpdate,
    RegulationWorkflowLogOut,
    RepealRegulationRequest,
    WorkflowActionRequest,
)
from api.services import audit as audit_svc
from api.services import context as context_svc
from api.services import document as doc_svc
from api.services import meeting as meeting_svc
from api.services import regulation as reg_svc
from api.services import regulation_import as reg_import_svc
from api.services.permission import get_user_permission_codes, get_user_permission_codes_for_org

router = APIRouter(prefix="/regulations", tags=["法規系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]

_EDITABLE_WORKFLOW_STATUSES = {
    RegulationWorkflowStatus.DRAFT,
    RegulationWorkflowStatus.REJECTED,
}


async def _get_reg_or_404(reg_id: uuid.UUID | str, session: DbDep) -> Regulation:
    reg = await reg_svc.get_regulation_by_identifier(session, reg_id)
    if reg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    return reg


def _assert_regulation_editable(reg: Regulation) -> None:
    if reg.workflow_status not in _EDITABLE_WORKFLOW_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此法規已進入審議或公布流程，請退回草稿或另開修正草案後再編輯",
        )


async def _get_article_or_404(
    reg: Regulation, article_id: uuid.UUID, session: DbDep
) -> RegulationArticle:
    article = await reg_svc.get_article(session, article_id)
    if article is None or article.regulation_id != reg.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此條文")
    return article


def _assert_creator(reg: Regulation, user: User) -> None:
    """確認操作者為法規建立者，否則拋出 403"""
    if reg.created_by != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有建立者可以執行此操作",
        )


class RegulationImportItemOut(BaseModel):
    filename: str | None = None
    ok: bool
    regulation: RegulationOut | None = None
    detail: str | None = None
    article_count: int = 0
    legislative_history: str | None = None
    warnings: list[str] = Field(default_factory=list)


class StructureContentRequest(BaseModel):
    content: str | None = Field(
        None,
        description="要解析的法規全文；未提供時使用目前儲存在法規上的 content",
    )
    replace_existing: bool = Field(
        False,
        description="已有結構化條文時是否以解析結果覆蓋（舊條文會軟刪除）",
    )


async def _assert_regulation_create_permission(
    session: AsyncSession,
    user: User,
    org_id: uuid.UUID,
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    if "regulation:create" not in codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="您在此組織下無起草法規的權限（需 regulation:create）",
        )


async def _assert_regulation_publish_permission(
    session: AsyncSession,
    user: User,
    org_id: uuid.UUID,
) -> None:
    if user.is_superuser:
        return
    codes = await get_user_permission_codes_for_org(session, user.id, org_id)
    if not {"regulation:publish", "regulation:president_publish", "regulation:admin"}.intersection(
        codes
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="匯入後直接標記現行需 regulation:publish、regulation:president_publish 或 regulation:admin 權限",
        )


# ── 全文搜尋 ─────────────────────────────────────────────────────────────────


@router.get(
    "/search",
    response_model=list[RegulationSearchResult],
    summary="全文搜尋法規（含條文內容）",
    responses={200: {"description": "搜尋結果（法規清單，含命中條文摘要）"}},
)
async def search_regulations(
    session: DbDep,
    user: OptionalUser,
    keyword: str = Query(..., min_length=1, max_length=100, description="搜尋關鍵字"),
    org_id: uuid.UUID | None = Query(None, description="限定組織"),
    active_only: bool = Query(True, description="僅搜尋已發布有效法規"),
    limit: int = Query(20, ge=1, le=50),
) -> list[Regulation]:
    """搜尋法規標題、前言、內容及各條文，回傳包含命中條文摘要的法規清單。"""
    return await reg_svc.search_regulations(
        session,
        keyword,
        org_id=org_id,
        active_only=active_only,
        published_only=(user is None),
        limit=limit,
    )


# ── CRUD ─────────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[RegulationListItem],
    summary="列出法規（輕量版，支援全文關鍵字過濾）",
)
async def list_regulations(
    session: DbDep,
    user: OptionalUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織"),
    category: RegulationCategory | None = Query(None, description="過濾分類"),
    active_only: bool = Query(False, description="僅顯示有效法規"),
    workflow_status: RegulationWorkflowStatus | None = Query(
        None, description="過濾審議狀態（如 under_review 用於議長集中待審清單）"
    ),
    keyword: str | None = Query(None, max_length=100, description="關鍵字搜尋（標題/內容）"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Regulation]:
    if user is None:
        active_only = True
    return await reg_svc.list_regulations(
        session,
        org_id=org_id,
        category=category,
        is_active=True if active_only else None,
        published_only=(user is None),
        workflow_status=workflow_status,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{reg_id}/usage-context",
    response_model=RegulationUsageContextOut,
    summary="取得法規使用脈絡",
)
async def regulation_usage_context(
    reg_id: str, session: DbDep, user: OptionalUser
) -> RegulationUsageContextOut:
    reg = await _get_reg_or_404(reg_id, session)
    if user is None and not await reg_svc.is_publicly_effective(session, reg):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    return await context_svc.regulation_usage_context(session, reg.id)


@router.get(
    "/{reg_id}",
    response_model=RegulationOut,
    summary="取得法規詳細（含 Markdown 內容、條文清單、修訂歷程）",
    responses={
        200: {"description": "法規完整資訊"},
        404: {"description": "法規不存在"},
    },
)
async def get_regulation(reg_id: str, session: DbDep, user: OptionalUser) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    # 未登入僅可查看已發布且有效的法規（避免草案外洩）
    if user is None and not await reg_svc.is_publicly_effective(session, reg):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    return reg


@router.post(
    "",
    response_model=RegulationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增法規草稿（需 regulation:create 權限）",
    responses={
        201: {"description": "法規草稿建立成功"},
        403: {"description": "需要 regulation:create 權限"},
    },
)
async def create_regulation(
    payload: RegulationCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """建立法規草稿，需在目標組織下擁有 regulation:create 權限（org-scoped）。"""
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, payload.org_id)
        if "regulation:create" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無起草法規的權限（需 regulation:create）",
            )
    reg = await reg_svc.create_regulation(session, data=payload, created_by=current_user.id)
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"title": reg.title, "org_id": str(reg.org_id), "category": reg.category.value},
        summary=f"建立法規草稿「{reg.title}」",
    )
    return reg


@router.post(
    "/import-docx",
    response_model=RegulationOut,
    status_code=status.HTTP_201_CREATED,
    summary="從 Word/PDF 法規文檔匯入法規（需 regulation:create 權限）",
    responses={
        201: {"description": "已從 DOCX/PDF 建立法規與結構化條文"},
        403: {"description": "需要 regulation:create 權限"},
        422: {"description": "文件格式無法解析"},
    },
)
async def import_regulation_docx(
    session: DbDep,
    current_user: CurrentUser,
    org_id: Annotated[uuid.UUID, Form(description="所屬組織 ID")],
    category: Annotated[
        RegulationCategory,
        Form(description="法規分類"),
    ] = RegulationCategory.PROCEDURE,
    publish_immediately: Annotated[
        bool,
        Form(description="匯入後直接標記為現行公開法規"),
    ] = False,
    change_brief: Annotated[
        str,
        Form(description="匯入後建立初始修訂快照的摘要"),
    ] = "匯入既有現行法規",
    file: Annotated[UploadFile, File(description="Word .docx 或 PDF 法規文檔")] = ...,
) -> Regulation:
    """上傳 Word/PDF 法規文件，解析章節條文與歷史沿革後建立法規。"""
    await _assert_regulation_create_permission(session, current_user, org_id)
    if publish_immediately:
        await _assert_regulation_publish_permission(session, current_user, org_id)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="檔案為空")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="DOCX 檔案不可超過 10 MB",
        )

    try:
        imported = await run_in_threadpool(
            reg_import_svc.parse_regulation_document,
            raw,
            file.filename,
        )
        reg = await reg_svc.create_regulation_from_import(
            session,
            data=imported,
            category=category,
            org_id=org_id,
            created_by=current_user.id,
        )
        if publish_immediately:
            reg = await reg_svc.publish_imported_regulation(
                session,
                reg,
                published_by=current_user.id,
                change_brief=change_brief,
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        ) from e

    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.import_docx",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "title": reg.title,
            "org_id": str(reg.org_id),
            "category": reg.category.value,
            "filename": file.filename,
            "article_count": len(imported.articles),
            "legislative_history": imported.legislative_history,
            "warnings": imported.warnings,
            "publish_immediately": publish_immediately,
        },
        summary=f"由文件匯入法規「{reg.title}」",
    )
    return reg


@router.post(
    "/import-documents",
    response_model=list[RegulationImportItemOut],
    summary="批次從 Word/PDF 法規文檔匯入法規（需 regulation:create 權限）",
)
async def import_regulation_documents(
    session: DbDep,
    current_user: CurrentUser,
    org_id: Annotated[uuid.UUID, Form(description="所屬組織 ID")],
    category: Annotated[
        RegulationCategory,
        Form(description="法規分類"),
    ] = RegulationCategory.PROCEDURE,
    publish_immediately: Annotated[
        bool,
        Form(description="匯入後直接標記為現行公開法規"),
    ] = False,
    change_brief: Annotated[
        str,
        Form(description="匯入後建立初始修訂快照的摘要"),
    ] = "匯入既有現行法規",
    files: Annotated[
        list[UploadFile],
        File(description="多個 Word .docx 或 PDF 法規文檔"),
    ] = ...,
) -> list[RegulationImportItemOut]:
    """一次上傳多份法規文件；單一檔案解析失敗不會中止整批。"""
    await _assert_regulation_create_permission(session, current_user, org_id)
    if publish_immediately:
        await _assert_regulation_publish_permission(session, current_user, org_id)
    if not files:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="請上傳檔案")
    if len(files) > 30:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="一次最多匯入 30 份文件",
        )

    results: list[RegulationImportItemOut] = []
    for file in files:
        raw = await file.read()
        if not raw:
            results.append(
                RegulationImportItemOut(
                    filename=file.filename,
                    ok=False,
                    detail="檔案為空",
                )
            )
            continue
        if len(raw) > 10 * 1024 * 1024:
            results.append(
                RegulationImportItemOut(
                    filename=file.filename,
                    ok=False,
                    detail="DOCX/PDF 檔案不可超過 10 MB",
                )
            )
            continue

        try:
            imported = await run_in_threadpool(
                reg_import_svc.parse_regulation_document,
                raw,
                file.filename,
            )
            reg = await reg_svc.create_regulation_from_import(
                session,
                data=imported,
                category=category,
                org_id=org_id,
                created_by=current_user.id,
            )
            if publish_immediately:
                reg = await reg_svc.publish_imported_regulation(
                    session,
                    reg,
                    published_by=current_user.id,
                    change_brief=change_brief,
                )
        except ValueError as e:
            results.append(
                RegulationImportItemOut(
                    filename=file.filename,
                    ok=False,
                    detail=str(e),
                )
            )
            continue

        await audit_svc.record(
            session,
            entity_type="regulation",
            entity_id=str(reg.id),
            action="regulation.import_document",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={
                "title": reg.title,
                "org_id": str(reg.org_id),
                "category": reg.category.value,
                "filename": file.filename,
                "article_count": len(imported.articles),
                "legislative_history": imported.legislative_history,
                "warnings": imported.warnings,
                "publish_immediately": publish_immediately,
            },
            summary=f"由文件匯入法規「{reg.title}」",
        )
        results.append(
            RegulationImportItemOut(
                filename=file.filename,
                ok=True,
                regulation=RegulationOut.model_validate(reg),
                article_count=len(imported.articles),
                legislative_history=imported.legislative_history,
                warnings=imported.warnings,
            )
        )

    return results


@router.post(
    "/{reg_id}/fork_draft",
    response_model=RegulationOut,
    status_code=status.HTTP_201_CREATED,
    summary="由既有法規分支出新草案（需 regulation:create 權限）",
    responses={
        201: {"description": "草案建立成功"},
        403: {"description": "需要 regulation:create 權限"},
    },
)
async def fork_draft_from_regulation(
    reg_id: str,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
        if "regulation:create" not in codes and "regulation:admin" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無起草法規的權限（需 regulation:create）",
            )
    draft = await reg_svc.fork_regulation_draft(session, reg, created_by=current_user.id)
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(draft.id),
        action="regulation.fork_draft",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"source_regulation_id": str(reg.id), "source_title": reg.title},
        summary=f"由「{reg.title}」分支新草案",
    )
    return draft


@router.patch(
    "/{reg_id}",
    response_model=RegulationOut,
    summary="更新法規內容（自動遞增版本，可附修訂摘要）",
    responses={
        200: {"description": "更新成功，版本號遞增"},
        403: {"description": "非建立者"},
        409: {"description": "狀態衝突"},
    },
)
async def update_regulation(
    reg_id: str,
    payload: RegulationUpdate,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以編輯")
    before = {
        "title": reg.title,
        "category": reg.category.value,
        "workflow_status": reg.workflow_status.value,
        "version": reg.version,
    }
    try:
        reg = await reg_svc.update_regulation(
            session, reg, data=payload, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "before": before,
            "after": {
                "title": reg.title,
                "category": reg.category.value,
                "workflow_status": reg.workflow_status.value,
                "version": reg.version,
            },
        },
        summary=f"更新法規「{reg.title}」",
    )
    return reg


# ── 狀態動作 ─────────────────────────────────────────────────────────────────


@router.post(
    "/{reg_id}/publish",
    response_model=RegulationOut,
    summary="（停用）直接發布法規",
    responses={
        200: {"description": "法規發布成功，修訂歷程已記錄"},
        403: {"description": "需要 regulation:publish 權限"},
        409: {"description": "法規已發布"},
    },
)
async def publish_regulation(
    reg_id: str,
    payload: RegulationPublishRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """
    此端點已停用：法規必須透過主席公布流程（president_publish）才可生效。
    """
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
        if "regulation:publish" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="您在此組織下無發布法規的權限（需 regulation:publish）",
            )
    try:
        result = await reg_svc.publish_regulation(
            session, reg, data=payload, published_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.publish",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"發布法規「{reg.title}」v{result.version}",
    )
    return result


@router.post(
    "/{reg_id}/archive",
    response_model=RegulationOut,
    summary="停用法規（需 regulation:archive 或 regulation:admin 權限）",
    responses={
        200: {"description": "法規停用成功"},
        403: {"description": "需要 regulation:archive 或 regulation:admin 權限"},
    },
)
async def archive_regulation(
    reg_id: str,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        # regulation:admin 可跨組織停用；regulation:archive 限本組織
        global_codes = await get_user_permission_codes(session, current_user.id)
        if "regulation:admin" not in global_codes:
            org_codes = await get_user_permission_codes_for_org(
                session, current_user.id, reg.org_id
            )
            if "regulation:archive" not in org_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您無停用此法規的權限（需 regulation:archive 或 regulation:admin）",
                )
    try:
        result = await reg_svc.archive_regulation(session, reg)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.archive",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"停用法規「{reg.title}」",
    )
    return result


@router.post(
    "/{reg_id}/repeal",
    response_model=RegulationOut,
    summary="廢止法規（需 regulation:publish 或 regulation:admin 權限）",
    responses={
        200: {"description": "法規廢止成功"},
        403: {"description": "需要 regulation:publish 或 regulation:admin 權限"},
        409: {"description": "法規已廢止或已停用"},
    },
    dependencies=[
        Depends(
            require_any(
                PermissionCode.REGULATION_PUBLISH,
                PermissionCode.REGULATION_ADMIN,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def repeal_regulation(
    reg_id: str,
    body: RepealRegulationRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """廢止法規，並可選設定替代法規"""
    reg = await _get_reg_or_404(reg_id, session)
    try:
        result = await reg_svc.repeal_regulation(session, reg, body.reason, body.replacement_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.repeal",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"廢止法規「{reg.title}」，原因：{body.reason}",
    )
    return result


@router.delete(
    "/{reg_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除草稿法規（僅未發布草稿）",
    responses={
        204: {"description": "刪除成功"},
        403: {"description": "非建立者"},
        409: {"description": "已發布法規不可直接刪除"},
    },
)
async def delete_regulation(reg_id: str, session: DbDep, current_user: CurrentUser) -> None:
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser and reg.created_by != current_user.id:
        global_codes = await get_user_permission_codes(session, current_user.id)
        if "regulation:admin" not in global_codes:
            org_codes = await get_user_permission_codes_for_org(
                session, current_user.id, reg.org_id
            )
            if "regulation:delete" not in org_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="您無刪除此法規的權限（需建立者、regulation:delete 或 regulation:admin）",
                )
    try:
        await reg_svc.delete_regulation(session, reg)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


# ── 修訂歷程 ─────────────────────────────────────────────────────────────────


@router.get(
    "/{reg_id}/revisions",
    response_model=list[RegulationRevisionOut],
    summary="取得法規修訂歷程",
)
async def get_revisions(reg_id: str, session: DbDep, _: OptionalUser) -> list[object]:
    if _ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    reg = await _get_reg_or_404(reg_id, session)
    return await reg_svc.list_regulation_revisions(session, reg.id)


# ── 條文管理 ─────────────────────────────────────────────────────────────────


@router.get(
    "/{reg_id}/articles",
    response_model=list[RegulationArticleOut],
    summary="取得法規條文清單（依 sort_index 排序，排除已刪除）",
)
async def list_articles(
    reg_id: str,
    session: DbDep,
    _: OptionalUser,
    include_deleted: bool = Query(False, description="是否包含已刪除條文（軟刪除）"),
) -> list[RegulationArticle]:
    reg = await _get_reg_or_404(reg_id, session)
    if _ is None and (reg.published_at is None or not reg.is_active):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    if include_deleted:
        if _ is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
        return reg.articles
    return [a for a in reg.articles if not a.is_deleted]


@router.get(
    "/{reg_id}/tree",
    response_model=list[RegulationTreeNodeOut],
    summary="取得法規樹狀結構（編>章>節>條>項>款>目）",
)
async def get_article_tree(
    reg_id: str,
    session: DbDep,
    _: OptionalUser,
) -> list[RegulationTreeNodeOut]:
    reg = await _get_reg_or_404(reg_id, session)
    if _ is None and (reg.published_at is None or not reg.is_active):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    return await reg_svc.get_article_tree(session, reg)


@router.post(
    "/{reg_id}/structure-content",
    response_model=RegulationOut,
    summary="將法規全文解析為結構化條文",
    responses={
        200: {"description": "解析並建立結構化條文成功"},
        403: {"description": "非建立者"},
        409: {"description": "狀態衝突或已有條文"},
        422: {"description": "全文格式無法解析"},
    },
)
async def structure_regulation_content(
    reg_id: str,
    payload: StructureContentRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以結構化條文"
        )
    try:
        structured = await reg_svc.structure_regulation_content(
            session,
            reg,
            content=payload.content,
            replace_existing=payload.replace_existing,
        )
    except ValueError as e:
        detail = str(e)
        code = (
            status.HTTP_409_CONFLICT
            if "已有結構化條文" in detail
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=code, detail=detail) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.structure_content",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"replace_existing": payload.replace_existing},
        summary=f"將法規「{reg.title}」全文轉為結構化條文",
    )
    return structured


@router.post(
    "/{reg_id}/articles",
    response_model=RegulationArticleOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增條文至法規",
    responses={
        201: {"description": "條文新增成功"},
        403: {"description": "非建立者"},
    },
)
async def add_article(
    reg_id: str,
    payload: RegulationArticleCreate,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> RegulationArticle:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以新增條文")
    article = await reg_svc.add_article(session, reg, data=payload)
    await audit_svc.record(
        session,
        entity_type="regulation_article",
        entity_id=str(article.id),
        action="regulation.article_create",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "regulation_id": str(reg.id),
            "article_type": article.article_type.value,
            "title": article.title,
            "legal_number": article.legal_number,
        },
        summary=f"新增法規「{reg.title}」條文",
    )
    return article


@router.patch(
    "/{reg_id}/articles/{article_id}",
    response_model=RegulationArticleOut,
    summary="更新條文內容",
    responses={
        200: {"description": "更新成功"},
        403: {"description": "非建立者"},
        404: {"description": "條文不存在"},
    },
)
async def update_article(
    reg_id: str,
    article_id: uuid.UUID,
    payload: RegulationArticleUpdate,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> RegulationArticle:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以修改條文")
    article = await _get_article_or_404(reg, article_id, session)
    before = {
        "article_type": article.article_type.value,
        "title": article.title,
        "legal_number": article.legal_number,
        "content": article.content,
        "is_deleted": article.is_deleted,
    }
    article = await reg_svc.update_article(session, article, data=payload)
    await audit_svc.record(
        session,
        entity_type="regulation_article",
        entity_id=str(article.id),
        action="regulation.article_update",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "regulation_id": str(reg.id),
            "before": before,
            "after": {
                "article_type": article.article_type.value,
                "title": article.title,
                "legal_number": article.legal_number,
                "content": article.content,
                "is_deleted": article.is_deleted,
            },
        },
        summary=f"更新法規「{reg.title}」條文",
    )
    return article


@router.post(
    "/{reg_id}/articles/{article_id}/move",
    response_model=RegulationArticleOut,
    summary="移動節點到新父層級並更新同層排序（子樹保持相對位置）",
)
async def move_article(
    reg_id: str,
    article_id: uuid.UUID,
    payload: ArticleMoveRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> RegulationArticle:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以移動條文")
    article = await _get_article_or_404(reg, article_id, session)
    before = {
        "parent_id": str(article.parent_id) if article.parent_id else None,
        "order_index": article.order_index,
    }
    article.parent_id = payload.parent_id
    article.order_index = payload.order_index
    await session.flush()
    await audit_svc.record(
        session,
        entity_type="regulation_article",
        entity_id=str(article.id),
        action="regulation.article_move",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "regulation_id": str(reg.id),
            "before": before,
            "after": {
                "parent_id": str(article.parent_id) if article.parent_id else None,
                "order_index": article.order_index,
            },
        },
        summary=f"移動法規「{reg.title}」條文",
    )
    return article


@router.delete(
    "/{reg_id}/articles/{article_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除條文（預設軟刪除，可選硬刪除）",
    responses={
        204: {"description": "刪除成功"},
        403: {"description": "非建立者"},
        404: {"description": "條文不存在"},
    },
)
async def delete_article(
    reg_id: str,
    article_id: uuid.UUID,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
    hard: bool = Query(False, description="硬刪除（物理移除，無法復原）"),
) -> None:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以刪除條文")
    article = await _get_article_or_404(reg, article_id, session)
    meta = {
        "regulation_id": str(reg.id),
        "article_type": article.article_type.value,
        "title": article.title,
        "legal_number": article.legal_number,
        "hard_delete": hard,
    }
    await reg_svc.delete_article(session, article, hard_delete=hard)
    await audit_svc.record(
        session,
        entity_type="regulation_article",
        entity_id=str(article_id),
        action="regulation.article_delete",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta=meta,
        summary=f"刪除法規「{reg.title}」條文",
    )


# ── 條文批次重排 ─────────────────────────────────────────────────────────────


@router.put(
    "/{reg_id}/articles/reorder",
    response_model=list[RegulationArticleOut],
    summary="批次更新條文排序（拖曳排序後送出）",
)
async def reorder_articles(
    reg_id: str,
    payload: ArticleReorderRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> list[RegulationArticle]:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以重新排序")
    try:
        articles = await reg_svc.reorder_articles(session, reg, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.article_reorder",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"item_count": len(payload.items)},
        summary=f"重排法規「{reg.title}」條文",
    )
    return articles


@router.post(
    "/{reg_id}/articles/auto-renumber",
    response_model=list[RegulationArticleOut],
    summary="自動重編條號（支援保留特殊條號）",
)
async def auto_renumber_articles(
    reg_id: str,
    payload: AutoRenumberRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission(PermissionCode.REGULATION_EDIT))],
) -> list[RegulationArticle]:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_regulation_editable(reg)
    if reg.created_by != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有建立者可以重編條號")
    articles = await reg_svc.auto_renumber_articles(
        session, reg, include_special_number=payload.include_special_number
    )
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.article_auto_renumber",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"include_special_number": payload.include_special_number},
        summary=f"自動重編法規「{reg.title}」條號",
    )
    return articles


@router.get(
    "/{reg_id}/amendment-comparison",
    response_model=list[AmendmentComparisonRowOut],
    summary="修正對照模式（三欄：修正條文、現行條文、說明）",
)
async def amendment_comparison(
    reg_id: str,
    session: DbDep,
    _: OptionalUser,
) -> list[AmendmentComparisonRowOut]:
    if _ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    reg = await _get_reg_or_404(reg_id, session)
    return await reg_svc.compare_amendment(session, reg)


@router.post(
    "/{reg_id}/amendment-comparison/export.pdf",
    summary="匯出修正條文對照表 PDF",
    dependencies=[
        Depends(
            require_any(
                PermissionCode.REGULATION_CREATE,
                PermissionCode.REGULATION_ADMIN,
                PermissionCode.ADMIN_ALL,
            )
        )
    ],
)
async def export_amendment_comparison_pdf(
    reg_id: str,
    body: AmendmentComparisonExportRequest,
    session: DbDep,
    _: CurrentUser,
) -> Response:
    reg = await _get_reg_or_404(reg_id, session)
    from api.services.official_print import (
        render_print_pdf,
        render_regulation_amendment_comparison_html,
    )

    rows = [
        {
            "article_key": row.article_key,
            "status": row.status,
            "revised_text": row.revised_text,
            "current_text": row.current_text,
            "note": row.note,
        }
        for row in body.rows
    ]
    html_content = render_regulation_amendment_comparison_html(
        regulation_title=reg.title,
        proposal_title=body.proposal_title,
        rationale=body.rationale,
        rows=rows,
    )
    pdf_bytes = await run_in_threadpool(render_print_pdf, html_content)
    safe_title = body.proposal_title.replace("/", "_").replace("\\", "_")
    filename = f"{safe_title}.pdf"
    encoded = quote(filename)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


@router.get(
    "/{reg_id}/reference-warnings",
    response_model=list[ReferenceWarningOut],
    summary="檢查條文參照失效警示",
)
async def reference_warnings(
    reg_id: str,
    session: DbDep,
    _: OptionalUser,
) -> list[ReferenceWarningOut]:
    if _ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    reg = await _get_reg_or_404(reg_id, session)
    return await reg_svc.validate_references(session, reg)


@router.get(
    "/{reg_id}/time-machine",
    response_model=RegulationTimeMachineOut,
    summary="Time Machine：回溯指定日期法規全貌",
)
async def regulation_time_machine(
    reg_id: str,
    session: DbDep,
    _: OptionalUser,
    as_of: datetime = Query(..., description="回溯時間點（ISO8601）"),
) -> RegulationTimeMachineOut:
    if _ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    reg = await _get_reg_or_404(reg_id, session)
    try:
        return await reg_svc.get_time_machine_snapshot(session, reg.id, as_of=as_of)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e


# ── 審議流程 ─────────────────────────────────────────────────────────────────


@router.get(
    "/{reg_id}/workflow_logs",
    response_model=list[RegulationWorkflowLogOut],
    summary="取得法規審議流程日誌",
)
async def get_workflow_logs(reg_id: str, session: DbDep, _: OptionalUser) -> list[object]:
    if _ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    reg = await _get_reg_or_404(reg_id, session)
    return await reg_svc.list_workflow_logs(session, reg.id)


@router.get(
    "/{reg_id}/eligible-meetings",
    summary="列出可推進此法案的會議（該法案已排入議程、同組織）",
)
async def list_eligible_meetings(reg_id: str, session: DbDep, _: CurrentUser) -> list[dict]:
    from sqlalchemy import select as _sel

    from api.models.meeting import Meeting, MeetingAgendaItem

    reg = await _get_reg_or_404(reg_id, session)
    result = await session.execute(
        _sel(Meeting)
        .join(MeetingAgendaItem, MeetingAgendaItem.meeting_id == Meeting.id)
        .where(MeetingAgendaItem.regulation_id == reg.id)
        .order_by(Meeting.starts_at.desc().nulls_last())
        .distinct()
    )
    return [
        {
            "id": str(m.id),
            "title": m.title,
            "status": m.status,
            "bill_stage": m.bill_stage,
            "starts_at": m.starts_at.isoformat() if m.starts_at else None,
        }
        for m in result.scalars().all()
    ]


# ── 修訂差異比對 ─────────────────────────────────────────────────────────────


class _RegDiffOut(BaseModel):
    from_version: int
    to_version: int
    unified_diff: str
    summary: str


@router.post(
    "/{reg_id}/diff",
    summary="比對兩個版本的法規全文差異",
)
async def regulation_diff(
    reg_id: str,
    session: DbDep,
    _: OptionalUser,
    from_version: int | None = Query(None, description="起始版本號（預設為最新版本的前一版）"),
    to_version: int | None = Query(None, description="目標版本號（預設為最新版本）"),
) -> _RegDiffOut:
    """回傳兩個修訂版本之間的 unified diff（Markdown 全文快照比對）。"""
    import difflib

    from sqlalchemy import select as _sel

    if _ is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    reg = await _get_reg_or_404(reg_id, session)

    from sqlalchemy import func as _func

    # Resolve version defaults without loading all revisions
    if to_version is None or from_version is None:
        bounds = (
            await session.execute(
                _sel(
                    _func.min(RegulationRevision.version),
                    _func.max(RegulationRevision.version),
                ).where(RegulationRevision.regulation_id == reg.id)
            )
        ).one()
        min_ver, max_ver = bounds
        if max_ver is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="此法規尚無修訂歷程可比對",
            )
        target_ver = to_version if to_version is not None else max_ver
        source_ver = from_version if from_version is not None else max(target_ver - 1, min_ver)
    else:
        target_ver = to_version
        source_ver = from_version

    # Fetch only the two needed revisions
    revs_result = await session.execute(
        _sel(RegulationRevision).where(
            RegulationRevision.regulation_id == reg.id,
            RegulationRevision.version.in_([source_ver, target_ver]),
        )
    )
    rev_map = {r.version: r for r in revs_result.scalars().all()}
    src_rev = rev_map.get(source_ver)
    tgt_rev = rev_map.get(target_ver)

    if src_rev is None or tgt_rev is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"找不到指定版本（from={source_ver}, to={target_ver}）",
        )

    src_lines = src_rev.content_snapshot.splitlines(keepends=True)
    tgt_lines = tgt_rev.content_snapshot.splitlines(keepends=True)
    diff = "".join(
        difflib.unified_diff(
            src_lines,
            tgt_lines,
            fromfile=f"v{src_rev.version}",
            tofile=f"v{tgt_rev.version}",
        )
    )

    added = sum(
        1 for line in diff.splitlines() if line.startswith("+") and not line.startswith("+++")
    )
    removed = sum(
        1 for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")
    )
    summary_text = f"新增 {added} 行，刪除 {removed} 行" if diff else "兩版本內容相同"

    return _RegDiffOut(
        from_version=src_rev.version,
        to_version=tgt_rev.version,
        unified_diff=diff,
        summary=summary_text,
    )


def _workflow_action(
    to_status: RegulationWorkflowStatus,
    required_perm: str,
    summary: str,
) -> object:
    """工廠函式：產生審議流程動作的 endpoint handler"""

    async def handler(
        reg_id: str,
        payload: WorkflowActionRequest,
        session: DbDep,
        current_user: CurrentUser,
    ) -> Regulation:
        reg = await _get_reg_or_404(reg_id, session)
        if not current_user.is_superuser:
            codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
            if required_perm not in codes and "regulation:admin" not in codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"需要 {required_perm} 權限",
                )
        # 排入議程／議會核定一律須透過會議：必須指定一場該法案已在議程上的會議
        if payload.meeting_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"{summary}須透過會議進行，請指定一場已將此法案排入議程的會議",
            )
        meeting = await meeting_svc.get_meeting(session, payload.meeting_id)
        if meeting is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到指定的議事會議",
            )
        # 不檢查 org 相等：議會（母組織）可審議各子組織提交的法案，
        # 與 meeting 端 list_proposable_regulations / advance_agenda_regulation 的跨組織設計一致。
        agenda_item = next((ai for ai in meeting.agenda_items if ai.regulation_id == reg.id), None)
        if agenda_item is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="此法案尚未排入該會議議程，請先於會議端將其帶入議程",
            )
        try:
            result = await reg_svc.transition_workflow(
                session,
                reg,
                to_status=to_status,
                actor_id=current_user.id,
                note=payload.note,
            )
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
        await audit_svc.record(
            session,
            entity_type="regulation",
            entity_id=str(reg.id),
            action=f"regulation.workflow_{to_status.value}",
            actor_id=str(current_user.id),
            actor_email=current_user.email,
            meta={
                "to_status": to_status.value,
                "note": payload.note,
                "meeting_id": str(payload.meeting_id),
                "agenda_item_id": str(agenda_item.id),
            },
            summary=f"{summary}「{reg.title}」（經會議「{meeting.title}」）",
        )
        return result

    handler.__name__ = f"workflow_{to_status.value}"
    return handler


@router.post(
    "/{reg_id}/submit",
    response_model=RegulationOut,
    summary="送交議會審議（需 regulation:submit 權限）",
)
async def submit_regulation(
    reg_id: str,
    payload: WorkflowActionRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """草案直接送審（DRAFT → UNDER_REVIEW），不自動建立公文。"""
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
        if "regulation:submit" not in codes and "regulation:admin" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要 regulation:submit 權限",
            )
    try:
        result = await reg_svc.transition_workflow(
            session,
            reg,
            to_status=RegulationWorkflowStatus.UNDER_REVIEW,
            actor_id=current_user.id,
            note=payload.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.workflow_under_review",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"to_status": RegulationWorkflowStatus.UNDER_REVIEW.value, "note": payload.note},
        summary=f"送交議會審議「{reg.title}」",
    )
    return result


router.add_api_route(
    "/{reg_id}/schedule",
    _workflow_action(RegulationWorkflowStatus.SCHEDULED, "regulation:schedule", "排入議程"),
    methods=["POST"],
    response_model=RegulationOut,
    summary="排入議程（需 regulation:schedule 權限）",
)
router.add_api_route(
    "/{reg_id}/council_approve",
    _workflow_action(
        RegulationWorkflowStatus.COUNCIL_APPROVED, "regulation:council_approve", "議會核定"
    ),
    methods=["POST"],
    response_model=RegulationOut,
    summary="議會核定法案（需 regulation:council_approve 權限）",
)


@router.post(
    "/{reg_id}/president_publish",
    response_model=RegulationOut,
    summary="主席公布法規（需 regulation:president_publish 權限，自動建立修訂歷程）",
)
async def president_publish(
    reg_id: str,
    payload: WorkflowActionRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """
    主席正式公布法規（council_approved → published）。
    同時建立修訂歷程快照，並設定 published_at。
    """
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
        if "regulation:president_publish" not in codes and "regulation:admin" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要 regulation:president_publish 權限",
            )
    try:
        import json

        from sqlalchemy import select as _sel

        def _normalize_article_type(value: str | ArticleType) -> ArticleType:
            return value if isinstance(value, ArticleType) else ArticleType(value)

        def _render_article_line(
            *,
            article_type: str | ArticleType,
            legal_number: str | None,
            title: str | None,
            content: str | None,
        ) -> str:
            normalized = _normalize_article_type(article_type)
            if normalized == ArticleType.ARTICLE:
                prefix = f"第 {legal_number or title or '?'} 條"
                body = (content or "").strip()
                return f"{prefix}　{body}".strip()
            return (content or title or "").strip()

        def _article_match_key(
            article_type: object,
            lineage_id: object,
            legal_number: object,
            title: object,
        ) -> str | None:
            """跨版本比對鍵：優先用 lineage_id（沿革識別碼，重新排序時保持穩定），
            舊快照尚無 lineage_id 時才 fallback 到法號/標題。

            不可用條文 id：修正案經 fork_regulation_draft 後條文會取得全新 UUID，
            以 id 比對會讓所有條文被誤判為「新增 + 刪除」。
            """
            if _normalize_article_type(article_type) != ArticleType.ARTICLE:
                return None
            if lineage_id:
                return f"lin:{lineage_id}"
            key = str(legal_number or "").strip() or str(title or "").strip()
            return f"num:{key}" if key else None

        def _build_amendment_body(
            previous_rows: list[dict], current_rows: list[RegulationArticle]
        ) -> str:
            previous_map: dict[str, dict] = {}
            for row in previous_rows:
                if row.get("is_deleted"):
                    continue
                key = _article_match_key(
                    row.get("article_type"),
                    row.get("lineage_id"),
                    row.get("legal_number"),
                    row.get("title"),
                )
                if key is not None:
                    previous_map[key] = row

            rows: list[tuple[str, str, str]] = []
            seen_keys: set[str] = set()

            for article in current_rows:
                if article.is_deleted:
                    continue
                key = _article_match_key(
                    article.article_type,
                    article.lineage_id,
                    article.legal_number,
                    article.title,
                )
                if key is None:
                    continue
                seen_keys.add(key)
                prev = previous_map.get(key)
                content_text = " ".join((article.content or "").split()) or "（無內容）"
                article_no = f"第 {article.legal_number or article.title or '?'} 條"
                if prev is None:
                    status = "新增"
                elif (prev.get("content") or "").strip() != (article.content or "").strip() or (
                    prev.get("title") or ""
                ).strip() != (article.title or "").strip():
                    status = "修正"
                elif (prev.get("legal_number") or "") != (article.legal_number or ""):
                    # 內容相同但條號變動 → 條次調整，於對照表標示原條號
                    status = "條次調整"
                    old_no = prev.get("legal_number") or prev.get("title") or "?"
                    article_no = f"第 {article.legal_number or '?'} 條（原第 {old_no} 條）"
                else:
                    continue
                rows.append((status, article_no, content_text))

            for key, row in previous_map.items():
                if key in seen_keys:
                    continue
                rows.append(
                    (
                        "刪除",
                        f"第 {row.get('legal_number') or row.get('title') or '?'} 條",
                        " ".join((row.get("content") or "").split()) or "（原內容）",
                    )
                )

            if not rows:
                return "（本次未偵測到條文內容異動）"

            status_width = max(4, max(len(status) for status, _, _ in rows))
            article_width = max(10, max(len(article_no) for _, article_no, _ in rows))
            header = f"{'異動':<{status_width}}  {'條號':<{article_width}}  內容"
            rule = f"{'─' * status_width}  {'─' * article_width}  {'─' * 24}"
            body_lines = [
                f"{status:<{status_width}}  {article_no:<{article_width}}  {content}"
                for status, article_no, content in rows
            ]
            return "\n".join([header, rule, *body_lines])

        # 1. 取得前一版修訂快照供比對
        prev_snapshot_result = await session.execute(
            _sel(RegulationRevision)
            .where(RegulationRevision.regulation_id == reg.id)
            .order_by(RegulationRevision.version.desc())
            .limit(1)
        )
        prev_rev = prev_snapshot_result.scalar_one_or_none()

        # 2. 流程狀態轉換
        await reg_svc.transition_workflow(
            session,
            reg,
            to_status=RegulationWorkflowStatus.PUBLISHED,
            actor_id=current_user.id,
            note=payload.note,
        )

        # 3. published_at + 修訂快照
        now = datetime.now(UTC)
        reg.published_at = now
        previous_article_snapshot = (
            json.loads(prev_rev.article_snapshot or "[]")
            if prev_rev and prev_rev.article_snapshot
            else []
        )
        amendment_body = _build_amendment_body(previous_article_snapshot, reg.articles)
        rev = RegulationRevision(
            regulation_id=reg.id,
            version=reg.version,
            change_brief=payload.note or "主席公布",
            is_total_amendment=(prev_rev is None),
            content_snapshot=reg.content,
            article_snapshot=reg_svc._article_snapshot_json(reg.articles),
            proposal_metadata_snapshot=reg.proposal_metadata,
            amended_at=now,
            amended_by=current_user.id,
        )
        session.add(rev)

        # 4. 查詢主席公布專用字號模板；若前端指定模板，優先使用指定模板。
        tmpl_result = await session.execute(
            _sel(DocumentSerialTemplate)
            .where(DocumentSerialTemplate.is_active.is_(True))
            .order_by(
                DocumentSerialTemplate.is_default_president_publish.desc(),
                DocumentSerialTemplate.updated_at.desc(),
            )
        )
        templates = list(tmpl_result.scalars().all())

        def _pick_president_publish_template(
            candidates: list[DocumentSerialTemplate],
        ) -> DocumentSerialTemplate | None:
            tmpl = next((t for t in candidates if t.is_default_president_publish), None)
            if tmpl is not None:
                return tmpl
            tmpl = next(
                (
                    t
                    for t in candidates
                    if t.org_prefix.strip() == "嶺班" and t.category_char.strip() == "主公"
                ),
                None,
            )
            if tmpl is not None:
                return tmpl
            tmpl = next((t for t in candidates if t.category_char.strip() == "主公"), None)
            if tmpl is not None:
                return tmpl
            return next(
                (
                    t
                    for t in candidates
                    if "主公" in f"{t.org_prefix}{t.category_char}".replace(" ", "")
                ),
                None,
            )

        tmpl: DocumentSerialTemplate | None = None
        if payload.serial_template_id is not None:
            tmpl = next((t for t in templates if t.id == payload.serial_template_id), None)
            if tmpl is None:
                raise ValueError("指定的主席公布字號模板不存在或已停用")
            if tmpl.org_id != reg.org_id:
                raise ValueError("指定的主席公布字號模板不屬於此法規組織")
        elif not (payload.manual_serial_number or "").strip():
            tmpl = _pick_president_publish_template(templates)

        if tmpl is None and not (payload.manual_serial_number or "").strip():
            raise ValueError(
                "找不到可用的主席公布字號模板，請先到字號模板管理設定「主席公布預設模板」"
            )

        # 5. 公布令本文
        action_verb = "修正" if prev_rev else "制定"
        # change_desc：使用者填寫的條文說明（如「第七條」「第一條、第二條」）
        change_desc = (payload.note or "").strip()
        if change_desc:
            decree_line = f"茲{action_verb}《{reg.title}》{change_desc}，公布之。"
        else:
            decree_line = f"茲{action_verb}《{reg.title}》，公布之。"

        doc_body = f"{decree_line}\n\n修正條文整理：\n{amendment_body}"

        pub_doc_data = DocumentCreate(
            title=f"公布《{reg.title}》",
            org_id=tmpl.org_id if tmpl else reg.org_id,
            category=DocumentCategory.DECREE,
            urgency=DocumentUrgency.NORMAL,
            classification=DocumentClassification.NORMAL,
            subject=None,
            doc_description=doc_body,
            content=doc_body,
            handler_name=current_user.display_name,
            handler_unit="主席",
            serial_template_id=tmpl.id if tmpl else None,
            manual_serial_number=payload.manual_serial_number,
        )
        pub_doc = await doc_svc.create_document(
            session, data=pub_doc_data, created_by=current_user.id
        )
        pub_doc.is_public = True
        pub_doc.regulation_id = reg.id
        pub_doc = await doc_svc.issue_document_directly(
            session,
            pub_doc,
            issued_by=current_user.id,
            comment="主席公布法規自動發文",
        )
        reg.published_document_id = pub_doc.id

        # 取代來源法規：修正案（fork）正式公布後，原現行法規自動退場，
        # 避免法規列表同時出現「修正前」與「修正後」兩個版本。
        if reg.source_regulation_id is not None:
            source = await session.get(Regulation, reg.source_regulation_id)
            if (
                source is not None
                and source.id != reg.id
                and source.is_active
                and source.published_at is not None
            ):
                session.add(
                    RegulationWorkflowLog(
                        regulation_id=source.id,
                        from_status=source.workflow_status,
                        to_status=RegulationWorkflowStatus.ARCHIVED,
                        actor_id=current_user.id,
                        note=f"由修正版本《{reg.title}》v{reg.version} 取代",
                    )
                )
                source.is_active = False
                source.workflow_status = RegulationWorkflowStatus.ARCHIVED
                source.repeal_replacement_id = reg.id

        await session.flush()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.workflow_published",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={
            "note": payload.note,
            "published_document_id": str(reg.published_document_id)
            if reg.published_document_id
            else None,
        },
        summary=f"主席公布法規「{reg.title}」",
    )
    try:
        from api.services.outbox import emit as outbox_emit

        await outbox_emit(
            session,
            event_type="regulation.published",
            payload={
                "regulation_id": str(reg.id),
                "regulation_title": reg.title,
                "org_id": str(reg.org_id),
                "actor_id": str(current_user.id),
                "actor_email": current_user.email or "",
            },
        )
    except Exception:
        logger.warning("emit regulation.published failed", exc_info=True)
    return reg


@router.post(
    "/{reg_id}/revise",
    response_model=RegulationOut,
    summary="再修正（需 regulation:revise 權限，將法規退回草稿重新編輯）",
)
async def revise_regulation(
    reg_id: str,
    payload: WorkflowActionRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """
    將法規從「送審中」或「議會核定」退回草稿，進行再修正。
    需擁有 regulation:revise 或 regulation:admin 權限。
    """
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
        if "regulation:revise" not in codes and "regulation:admin" not in codes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要 regulation:revise 或 regulation:admin 權限",
            )
    try:
        reg = await reg_svc.transition_workflow(
            session,
            reg,
            to_status=RegulationWorkflowStatus.DRAFT,
            actor_id=current_user.id,
            note=payload.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.workflow_draft",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"note": payload.note},
        summary=f"再修正法規「{reg.title}」",
    )
    return reg


@router.post(
    "/{reg_id}/reject",
    response_model=RegulationOut,
    summary="退回法規（需任一審議權限）",
)
async def reject_regulation(
    reg_id: str,
    payload: WorkflowActionRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """
    退回法規至草稿或上一階段。
    需擁有任一審議相關權限（schedule、council_approve、president_publish 或 admin）。
    退回原因必填（payload.note）。
    """
    reg = await _get_reg_or_404(reg_id, session)
    if payload.note is None or not payload.note.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="退回法規必須填寫退回原因",
        )
    if not current_user.is_superuser:
        codes = await get_user_permission_codes_for_org(session, current_user.id, reg.org_id)
        workflow_perms = {
            "regulation:submit",
            "regulation:schedule",
            "regulation:council_approve",
            "regulation:president_publish",
            "regulation:admin",
        }
        if not workflow_perms.intersection(codes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="需要任一審議相關權限才能退回法規",
            )
    try:
        reg = await reg_svc.transition_workflow(
            session,
            reg,
            to_status=RegulationWorkflowStatus.REJECTED,
            actor_id=current_user.id,
            note=payload.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.workflow_rejected",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"note": payload.note},
        summary=f"退回法規「{reg.title}」",
    )
    return reg


# ── 列印法規（標準法規格式 PDF）───────────────────────────────────────────────


@router.get(
    "/{reg_id}/print",
    response_class=Response,
    summary="下載法規 PDF",
)
async def print_regulation(
    reg_id: str,
    session: DbDep,
    _user: OptionalUser,
) -> Response:
    """直接產生並下載法規彙編格式 PDF。"""
    from api.services.official_print import render_print_pdf, render_regulation_print_html

    reg = await _get_reg_or_404(reg_id, session)

    # 未登入只能看已發布的
    if reg.published_at is None and _user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")

    html_content = render_regulation_print_html(reg)
    pdf_bytes = await run_in_threadpool(render_print_pdf, html_content)
    filename = f"{reg.title.replace('/', '_').replace('\\', '_')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


# ── 整部法規凍結/解凍 ───────────────────────────────────────────────────────���─


class FreezeRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=500, description="凍結依據說明")
    freeze_document_id: uuid.UUID | None = Field(None, description="凍結依據公文 ID（選填）")


@router.post(
    "/{reg_id}/freeze",
    response_model=RegulationOut,
    summary="凍結整部法規（需 regulation:archive 或 regulation:admin）",
)
async def freeze_regulation(
    reg_id: str,
    payload: FreezeRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """
    凍結整部法規（不同於停用：凍結後仍顯示但帶警告橫幅，法律效力暫停）。
    需 regulation:archive 或 regulation:admin 權限。
    """
    from datetime import UTC
    from datetime import datetime as _dt

    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        global_codes = await get_user_permission_codes(session, current_user.id)
        if "regulation:admin" not in global_codes:
            org_codes = await get_user_permission_codes_for_org(
                session, current_user.id, reg.org_id
            )
            if "regulation:archive" not in org_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="需要 regulation:archive 或 regulation:admin 權限",
                )
    reg.freeze_reason = payload.reason
    reg.freeze_at = _dt.now(UTC)
    reg.freeze_document_id = payload.freeze_document_id
    await session.flush()
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.freeze",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        meta={"reason": payload.reason},
        summary=f"凍結法規「{reg.title}」",
    )
    return reg


@router.post(
    "/{reg_id}/unfreeze",
    response_model=RegulationOut,
    summary="解凍整部法規（需 regulation:archive 或 regulation:admin）",
)
async def unfreeze_regulation(
    reg_id: str,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    if not current_user.is_superuser:
        global_codes = await get_user_permission_codes(session, current_user.id)
        if "regulation:admin" not in global_codes:
            org_codes = await get_user_permission_codes_for_org(
                session, current_user.id, reg.org_id
            )
            if "regulation:archive" not in org_codes:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="需要 regulation:archive 或 regulation:admin 權限",
                )
    reg.freeze_reason = None
    reg.freeze_at = None
    reg.freeze_document_id = None
    await session.flush()
    await audit_svc.record(
        session,
        entity_type="regulation",
        entity_id=str(reg.id),
        action="regulation.unfreeze",
        actor_id=str(current_user.id),
        actor_email=current_user.email,
        summary=f"解凍法規「{reg.title}」",
    )
    return reg
