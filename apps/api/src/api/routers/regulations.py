"""
法規系統 Router
==============
RBAC 權限說明：
  - regulation:create  → 建立法規草稿
  - regulation:publish → 發布法規（建立修訂歷程）
  - regulation:admin   → 管理員操作（停用、刪除）
公開法規（published_at 非 None 且 is_active=True）無需登入即可查詢。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.regulation import Regulation, RegulationArticle, RegulationCategory
from api.models.user import User
from api.schemas.regulation import (
    RegulationArticleCreate,
    RegulationArticleOut,
    RegulationArticleUpdate,
    RegulationCreate,
    RegulationListItem,
    RegulationOut,
    RegulationPublishRequest,
    RegulationRevisionOut,
    RegulationSearchResult,
    RegulationUpdate,
)
from api.services import regulation as reg_svc

router = APIRouter(prefix="/regulations", tags=["法規系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


async def _get_reg_or_404(reg_id: uuid.UUID, session: DbDep) -> Regulation:
    reg = await reg_svc.get_regulation(session, reg_id)
    if reg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    return reg


async def _get_article_or_404(reg: Regulation, article_id: uuid.UUID, session: DbDep) -> RegulationArticle:
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


# ── 全文搜尋 ─────────────────────────────────────────────────────────────────

@router.get(
    "/search",
    response_model=list[RegulationSearchResult],
    summary="全文搜尋法規（含條文內容）",
    responses={200: {"description": "搜尋結果（法規清單，含命中條文摘要）"}},
)
async def search_regulations(
    session: DbDep,
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
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None, description="過濾組織"),
    category: RegulationCategory | None = Query(None, description="過濾分類"),
    active_only: bool = Query(False, description="僅顯示有效法規"),
    keyword: str | None = Query(None, max_length=100, description="關鍵字搜尋（標題/內容）"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Regulation]:
    return await reg_svc.list_regulations(
        session,
        org_id=org_id,
        category=category,
        is_active=True if active_only else None,
        keyword=keyword,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{reg_id}",
    response_model=RegulationOut,
    summary="取得法規詳細（含 Markdown 內容、條文清單、修訂歷程）",
    responses={
        200: {"description": "法規完整資訊"},
        404: {"description": "法規不存在"},
    },
)
async def get_regulation(
    reg_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> Regulation:
    return await _get_reg_or_404(reg_id, session)


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
    current_user: Annotated[User, Depends(require_permission("regulation:create"))],
) -> Regulation:
    return await reg_svc.create_regulation(session, data=payload, created_by=current_user.id)


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
    reg_id: uuid.UUID,
    payload: RegulationUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_creator(reg, current_user)
    try:
        return await reg_svc.update_regulation(
            session, reg, data=payload, updated_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


# ── 狀態動作 ─────────────────────────────────────────────────────────────────

@router.post(
    "/{reg_id}/publish",
    response_model=RegulationOut,
    summary="發布法規（需 regulation:publish 權限，自動建立修訂歷程）",
    responses={
        200: {"description": "法規發布成功，修訂歷程已記錄"},
        403: {"description": "需要 regulation:publish 權限"},
        409: {"description": "法規已發布"},
    },
)
async def publish_regulation(
    reg_id: uuid.UUID,
    payload: RegulationPublishRequest,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission("regulation:publish"))],
) -> Regulation:
    """
    發布法規並記錄修訂歷程。
    發布後 `published_at` 非 None，法規成為公開可查狀態。
    若需再次修訂，請更新內容後使用 `/re-publish` 端點（TODO）。
    """
    reg = await _get_reg_or_404(reg_id, session)
    try:
        return await reg_svc.publish_regulation(
            session, reg, data=payload, published_by=current_user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


@router.post(
    "/{reg_id}/archive",
    response_model=RegulationOut,
    summary="停用法規（需 regulation:admin 權限）",
    responses={
        200: {"description": "法規停用成功"},
        403: {"description": "需要 regulation:admin 權限或為建立者"},
    },
)
async def archive_regulation(
    reg_id: uuid.UUID,
    session: DbDep,
    current_user: Annotated[User, Depends(require_permission("regulation:admin"))],
) -> Regulation:
    reg = await _get_reg_or_404(reg_id, session)
    try:
        return await reg_svc.archive_regulation(session, reg)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e


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
async def delete_regulation(
    reg_id: uuid.UUID, session: DbDep, current_user: CurrentUser
) -> None:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_creator(reg, current_user)
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
async def get_revisions(
    reg_id: uuid.UUID, session: DbDep, _: CurrentUser
) -> list[object]:
    await _get_reg_or_404(reg_id, session)
    return await reg_svc.list_regulation_revisions(session, reg_id)


# ── 條文管理 ─────────────────────────────────────────────────────────────────

@router.get(
    "/{reg_id}/articles",
    response_model=list[RegulationArticleOut],
    summary="取得法規條文清單（依 sort_index 排序，排除已刪除）",
)
async def list_articles(
    reg_id: uuid.UUID,
    session: DbDep,
    _: CurrentUser,
    include_deleted: bool = Query(False, description="是否包含已刪除條文（軟刪除）"),
) -> list[RegulationArticle]:
    reg = await _get_reg_or_404(reg_id, session)
    if include_deleted:
        return reg.articles
    return [a for a in reg.articles if not a.is_deleted]


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
    reg_id: uuid.UUID,
    payload: RegulationArticleCreate,
    session: DbDep,
    current_user: CurrentUser,
) -> RegulationArticle:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_creator(reg, current_user)
    return await reg_svc.add_article(session, reg, data=payload)


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
    reg_id: uuid.UUID,
    article_id: uuid.UUID,
    payload: RegulationArticleUpdate,
    session: DbDep,
    current_user: CurrentUser,
) -> RegulationArticle:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_creator(reg, current_user)
    article = await _get_article_or_404(reg, article_id, session)
    return await reg_svc.update_article(session, article, data=payload)


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
    reg_id: uuid.UUID,
    article_id: uuid.UUID,
    session: DbDep,
    current_user: CurrentUser,
    hard: bool = Query(False, description="硬刪除（物理移除，無法復原）"),
) -> None:
    reg = await _get_reg_or_404(reg_id, session)
    _assert_creator(reg, current_user)
    article = await _get_article_or_404(reg, article_id, session)
    await reg_svc.delete_article(session, article, hard_delete=hard)
