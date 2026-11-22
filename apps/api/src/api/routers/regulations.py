"""法規雲端資料查詢、歷史版本與公布；來源管理沿用組織權限。"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.cache import cache_get, cache_invalidate, cache_set
from api.core.database import get_db
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.models.regulation import (
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
    RegulationWorkflowStatus,
)
from api.models.user import User
from api.routers._common import or_404
from api.schemas.context import RegulationUsageContextOut
from api.schemas.regulation import (
    ReferenceWarningOut,
    RegulationArticleOut,
    RegulationListItem,
    RegulationOut,
    RegulationPublishRequest,
    RegulationRevisionOut,
    RegulationSearchResult,
    RegulationTimeMachineOut,
    RegulationTreeNodeOut,
)
from api.services import audit as audit_svc
from api.services import context as context_svc
from api.services import regulation as reg_svc
from api.services.permission import get_user_permission_codes_for_org

logger = logging.getLogger(__name__)


async def _invalidate_public_regulations_cache(org_id: uuid.UUID) -> None:
    """Helper to invalidate public regulation list cache for an org + cross-org 'all'."""
    await cache_invalidate(f"reg:public:v1:org:{org_id}:*")
    await cache_invalidate("reg:public:v1:org:all:*")


def build_public_regulations_cache_key(
    org_id: uuid.UUID | None,
    category: RegulationCategory | None,
    active_only: bool,
    limit: int,
    offset: int,
) -> str:
    """
    Build canonical cache key for public regulations list.

    Key format: reg:public:v1:org:{org_id}:{digest}
    Digest contains all parameters affecting the response (category/active_only/limit/offset).
    org_id is in prefix to enable efficient wildcard invalidation.
    """
    org_part = str(org_id) if org_id else "all"
    cache_params = {
        "category": category.value if category else "all",
        "active_only": active_only,
        "limit": limit,
        "offset": offset,
    }
    serialized = json.dumps(cache_params, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(serialized.encode()).hexdigest()[:16]
    return f"reg:public:v1:org:{org_part}:{digest}"


router = APIRouter(prefix="/regulations", tags=["法規系統"])

from api.routers.regulation_sync import router as sync_router  # noqa: E402

router.include_router(sync_router)

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


async def _get_reg_or_404(reg_id: uuid.UUID | str, session: DbDep) -> Regulation:
    reg = await reg_svc.get_regulation_by_identifier(session, reg_id)
    return or_404(reg, "找不到此法規")


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
            detail="您在此組織下無公布法規的權限",
        )


@router.get(
    "/search",
    response_model=list[RegulationSearchResult],
    summary="全文搜尋法規（含條文內容）",
    responses={200: {"description": "搜尋結果（法規清單，含命中條文摘要）"}},
)
async def search_regulations(
    session: DbDep,
    user: OptionalUser,
    keyword: str = Query(
        ..., min_length=1, max_length=100, pattern=r"^[^\x00]*$", description="搜尋關鍵字"
    ),
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
    keyword: str | None = Query(
        None, max_length=100, pattern=r"^[^\x00]*$", description="關鍵字搜尋（標題/內容）"
    ),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Regulation]:
    if user is None:
        active_only = True

    # 公共查詢條件：未登入、無關鍵字、無 workflow 過濾
    # 所有影響回應的查詢參數都必須納入快取鍵（防止 limit/offset/category 洩漏）
    is_public_query = user is None and keyword is None and workflow_status is None

    cache_key = None
    if is_public_query:
        cache_key = build_public_regulations_cache_key(
            org_id=org_id,
            category=category,
            active_only=active_only,
            limit=limit,
            offset=offset,
        )

        cached = await cache_get(cache_key)
        if cached is not None:
            return [RegulationListItem.model_validate(item) for item in cached]

    # 計時：測量 service 層耗時（用於效能診斷）
    t0 = time.perf_counter()
    result = await reg_svc.list_regulations(
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
    service_ms = (time.perf_counter() - t0) * 1000
    if service_ms > 200:  # 只記錄慢查詢
        logger.warning(
            "slow regulations list service: %.1fms cache_key=%s",
            service_ms,
            cache_key if is_public_query else "non-public",
        )

    # 只在公共查詢且無錯誤時寫入快取（TTL 60s；法規需一致性，不使用 stale-while-revalidate）
    if is_public_query and result is not None:
        await cache_set(
            cache_key,
            [RegulationListItem.model_validate(r).model_dump(mode="json") for r in result],
            ttl=60,
        )

    return result


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
    if user is None:
        reg = await reg_svc.get_public_regulation_by_identifier(session, reg_id)
        return or_404(reg, "找不到此法規")

    reg = await reg_svc.get_regulation_detail_by_identifier(session, reg_id)
    if reg is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此法規")
    return reg


@router.post(
    "/{reg_id}/publish",
    response_model=RegulationOut,
    summary="公布法規（需組織內公布或管理權限）",
    responses={
        200: {"description": "公布成功，版本快照已記錄"},
        403: {"description": "需要 regulation:publish 權限"},
        409: {"description": "法規已公布、已廢止、已封存或尚無內容"},
    },
)
async def publish_regulation(
    reg_id: str,
    payload: RegulationPublishRequest,
    session: DbDep,
    current_user: CurrentUser,
) -> Regulation:
    """公布法規並保留快照；不建立審議流程或自動公文。"""
    reg = await _get_reg_or_404(reg_id, session)
    await _assert_regulation_publish_permission(session, current_user, reg.org_id)
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
    await _invalidate_public_regulations_cache(reg.org_id)
    return result


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
