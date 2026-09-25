"""問卷系統 Router - 問卷管理 / 題目 / 填答 / 統計"""

from __future__ import annotations

import contextlib
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.core.cache import cache_invalidate, cache_invalidate_dashboard
from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.core.posthog import get_posthog_client
from api.dependencies.auth import get_current_active_user, get_optional_user
from api.dependencies.permissions import require_permission
from api.email.sender import send_branded_email
from api.models.survey import Survey, SurveyQuestion, SurveyResponse, SurveyStatus
from api.models.user import User
from api.routers._common import or_404
from api.schemas.survey import (
    SurveyCreate,
    SurveyImageOut,
    SurveyListItem,
    SurveyOut,
    SurveyQuestionCreate,
    SurveyQuestionOut,
    SurveyQuestionUpdate,
    SurveyResponseAdminItem,
    SurveyResponseOut,
    SurveyStats,
    SurveySubmit,
    SurveyUpdate,
)
from api.services import activity as activity_svc
from api.services import audit as audit_svc
from api.services import survey as survey_svc
from api.services.storage import get_storage

router = APIRouter(prefix="/surveys", tags=["問卷系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


# ── 輔助 ──────────────────────────────────────────────────────────────────────


async def _survey_or_404(survey_id: uuid.UUID | str, session: DbDep) -> Survey:
    s = await survey_svc.get_survey_by_identifier(session, survey_id)
    return or_404(s, "找不到此問卷")


async def _question_or_404(question_id: uuid.UUID, session: DbDep) -> SurveyQuestion:
    from sqlalchemy import select

    result = await session.execute(select(SurveyQuestion).where(SurveyQuestion.id == question_id))
    q = result.scalar_one_or_none()
    return or_404(q, "找不到此題目")


async def _has_survey_manage(session: AsyncSession, user: User) -> bool:
    if user.is_superuser:
        return True
    from api.services.permission import get_user_permission_codes

    codes = await get_user_permission_codes(session, user.id)
    return str(PermissionCode.SURVEY_MANAGE) in codes or str(PermissionCode.ADMIN_ALL) in codes


async def _can_manage_survey(
    session: AsyncSession, user: User, activity_id: uuid.UUID | None
) -> bool:
    if await _has_survey_manage(session, user):
        return True
    return await activity_svc.can_manage_activity_resource(session, user, activity_id)


async def _require_survey_manager(
    session: AsyncSession, user: User, activity_id: uuid.UUID | None
) -> None:
    if await _can_manage_survey(session, user, activity_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要權限：survey:manage")


async def _response_with_answers(session: AsyncSession, response_id: uuid.UUID) -> SurveyResponse:
    result = await session.execute(
        select(SurveyResponse)
        .options(selectinload(SurveyResponse.answers))
        .where(SurveyResponse.id == response_id)
    )
    return result.scalar_one()


async def _invalidate_response_caches(user: User | None) -> None:
    if user is None:
        return
    user_id = str(user.id)
    await cache_invalidate_dashboard(user_id)
    await cache_invalidate(f"task_count:{user_id}")


# ── 圖片上傳 ──────────────────────────────────────────────────────────────────


@router.post(
    "/images",
    response_model=SurveyImageOut,
    status_code=status.HTTP_201_CREATED,
    summary="上傳問卷圖片（survey:manage）",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def upload_survey_image(file: UploadFile = File(...)) -> SurveyImageOut:
    """上傳本地圖片，回傳可供題目引用的 URL。"""
    storage = get_storage()
    try:
        stored = await storage.save(file, prefix="surveys")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    if not stored.content_type.startswith("image/"):
        await storage.delete(stored.storage_key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只能上傳圖片檔案")
    return SurveyImageOut(url=stored.url, filename=stored.filename)


# ── 問卷 CRUD ─────────────────────────────────────────────────────────────────


@router.get("", response_model=list[SurveyListItem], summary="列出問卷")
async def list_surveys(
    session: DbDep,
    user: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    activity_id: uuid.UUID | None = Query(None),
    status_filter: SurveyStatus | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Survey]:
    if not await _has_survey_manage(session, user):
        return await survey_svc.list_respondable_surveys(
            session,
            user,
            org_id=org_id,
            activity_id=activity_id,
            status=status_filter,
            limit=limit,
            offset=offset,
        )
    return await survey_svc.list_surveys(
        session,
        org_id=org_id,
        activity_id=activity_id,
        status=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/public",
    response_model=list[SurveyListItem],
    summary="公開列出問卷（未登入）",
)
async def list_public_surveys(
    session: DbDep,
    status_filter: SurveyStatus | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Survey]:
    """列出公開問卷（僅 is_public 且開放/已截止）；草稿與封存不會出現。"""
    if status_filter not in (None, SurveyStatus.OPEN, SurveyStatus.CLOSED):
        status_filter = None
    return await survey_svc.list_surveys(
        session, status=status_filter, public_only=True, limit=limit, offset=offset
    )


@router.get("/{survey_id}", response_model=SurveyOut, summary="取得問卷詳細（含題目）")
async def get_survey(survey_id: str, session: DbDep, user: CurrentUser) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    if not await _can_manage_survey(session, user, survey.activity_id):
        try:
            await survey_svc.check_survey_access(session, survey, user)
        except PermissionError as e:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    return survey


@router.get("/public/{survey_id}", response_model=SurveyOut, summary="公開取得開放問卷（未登入）")
async def get_public_survey(survey_id: str, session: DbDep) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    if survey.status not in (SurveyStatus.OPEN, SurveyStatus.CLOSED):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此問卷")
    if not survey.is_public:
        try:
            await survey_svc.check_survey_access(session, survey, None)
        except PermissionError as e:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    return survey


@router.post(
    "",
    response_model=SurveyOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增問卷",
)
async def create_survey(payload: SurveyCreate, session: DbDep, user: CurrentUser) -> Survey:
    await _require_survey_manager(session, user, payload.activity_id)
    survey = await survey_svc.create_survey(session, data=payload, created_by=user.id)
    await audit_svc.record(
        session,
        entity_type="survey",
        entity_id=str(survey.id),
        action="survey.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "title": survey.title,
            "org_id": str(survey.org_id),
            "activity_id": str(survey.activity_id) if survey.activity_id else None,
            "is_anonymous": survey.is_anonymous,
            "allow_multiple": survey.allow_multiple,
            "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
            "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
            "announcement": survey.announcement,
            "announcement_title": survey.announcement_title,
            "show_announcement_popup": survey.show_announcement_popup,
        },
        summary=f"建立問卷「{survey.title}」",
    )
    return await _survey_or_404(survey.id, session)


@router.patch(
    "/{survey_id}",
    response_model=SurveyOut,
    summary="更新問卷基本資料（草稿或開放中）",
)
async def update_survey(
    survey_id: str, payload: SurveyUpdate, session: DbDep, user: CurrentUser
) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    before = {
        "title": survey.title,
        "description": survey.description,
        "is_anonymous": survey.is_anonymous,
        "allow_multiple": survey.allow_multiple,
        "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
        "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
        "announcement": survey.announcement,
        "announcement_title": survey.announcement_title,
        "show_announcement_popup": survey.show_announcement_popup,
    }
    try:
        survey = await survey_svc.update_survey(
            session, survey, data=payload, updated_by_id=user.id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey",
        entity_id=str(survey.id),
        action="survey.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "before": before,
            "after": {
                "title": survey.title,
                "description": survey.description,
                "is_anonymous": survey.is_anonymous,
                "allow_multiple": survey.allow_multiple,
                "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
                "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
                "announcement": survey.announcement,
                "announcement_title": survey.announcement_title,
                "show_announcement_popup": survey.show_announcement_popup,
            },
        },
        summary=f"更新問卷「{survey.title}」",
    )
    return survey


@router.post(
    "/{survey_id}/open",
    response_model=SurveyOut,
    summary="開放問卷填答",
)
async def open_survey(survey_id: str, session: DbDep, user: CurrentUser) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    try:
        survey = await survey_svc.open_survey(session, survey)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey",
        entity_id=str(survey.id),
        action="survey.open",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"status": survey.status.value},
        summary=f"開放問卷「{survey.title}」",
    )
    return survey


@router.post(
    "/{survey_id}/close",
    response_model=SurveyOut,
    summary="關閉問卷",
)
async def close_survey(survey_id: str, session: DbDep, user: CurrentUser) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    try:
        survey = await survey_svc.close_survey(session, survey)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey",
        entity_id=str(survey.id),
        action="survey.close",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"status": survey.status.value},
        summary=f"關閉問卷「{survey.title}」",
    )
    return survey


# ── 題目 CRUD ─────────────────────────────────────────────────────────────────


@router.post(
    "/{survey_id}/questions",
    response_model=SurveyQuestionOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增題目（草稿或開放中）",
)
async def add_question(
    survey_id: str, payload: SurveyQuestionCreate, session: DbDep, user: CurrentUser
) -> SurveyQuestion:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    try:
        question = await survey_svc.add_question(session, survey, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey_question",
        entity_id=str(question.id),
        action="survey.question_create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "survey_id": str(survey.id),
            "survey_title": survey.title,
            "question_type": question.question_type.value,
            "is_required": question.is_required,
            "order_index": question.order_index,
        },
        summary=f"新增問卷「{survey.title}」題目",
    )
    return question


@router.patch(
    "/questions/{question_id}",
    response_model=SurveyQuestionOut,
    summary="更新題目（草稿或開放中）",
)
async def update_question(
    question_id: uuid.UUID, payload: SurveyQuestionUpdate, session: DbDep, user: CurrentUser
) -> SurveyQuestion:
    question = await _question_or_404(question_id, session)
    survey = await _survey_or_404(question.survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    before = {
        "question_text": question.question_text,
        "question_type": question.question_type.value,
        "is_required": question.is_required,
        "min_value": question.min_value,
        "max_value": question.max_value,
        "placeholder": question.placeholder,
        "order_index": question.order_index,
    }
    try:
        question = await survey_svc.update_question(session, question, data=payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey_question",
        entity_id=str(question.id),
        action="survey.question_update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "survey_id": str(question.survey_id),
            "before": before,
            "after": {
                "question_text": question.question_text,
                "question_type": question.question_type.value,
                "is_required": question.is_required,
                "min_value": question.min_value,
                "max_value": question.max_value,
                "placeholder": question.placeholder,
                "order_index": question.order_index,
            },
        },
        summary="更新問卷題目",
    )
    return question


@router.delete(
    "/questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除題目（草稿或開放中）",
)
async def delete_question(question_id: uuid.UUID, session: DbDep, user: CurrentUser) -> None:
    question = await _question_or_404(question_id, session)
    survey = await _survey_or_404(question.survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    meta = {
        "survey_id": str(question.survey_id),
        "question_text": question.question_text,
        "question_type": question.question_type.value,
        "is_required": question.is_required,
    }
    try:
        await survey_svc.delete_question(session, question)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey_question",
        entity_id=str(question_id),
        action="survey.question_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=meta,
        summary="刪除問卷題目",
    )


# ── 填答 ─────────────────────────────────────────────────────────────────────


@router.post(
    "/{survey_id}/submit",
    response_model=SurveyResponseOut,
    status_code=status.HTTP_201_CREATED,
    summary="提交填答",
)
async def submit_response(
    survey_id: str,
    payload: SurveySubmit,
    session: DbDep,
    user: OptionalUser,
) -> object:
    survey = await _survey_or_404(survey_id, session)
    try:
        await survey_svc.check_survey_access(session, survey, user)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    try:
        response = await survey_svc.submit_response(
            session,
            survey,
            respondent_id=user.id if user else None,
            data=payload,
            respondent_email=user.email if user else None,
        )
    except IntegrityError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="您已填答過此問卷（唯一性衝突）",
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey_response",
        entity_id=str(response.id),
        action="survey.response_submit",
        actor_id=str(user.id) if user else None,
        actor_email=user.email if user else None,
        meta={
            "survey_id": str(survey.id),
            "survey_title": survey.title,
            "is_anonymous": survey.is_anonymous,
            "answer_count": len(payload.answers),
        },
        summary=f"提交問卷「{survey.title}」填答",
    )
    await _invalidate_response_caches(user)

    reloaded = await _response_with_answers(session, response.id)

    # 選用：寄送回答副本到填答者信箱（品牌範本；佇列失敗不應阻擋填答成功）
    if payload.email_copy and user and user.email:
        subject, copy_context = survey_svc.render_response_copy_email(
            survey, list(survey.questions), list(reloaded.answers)
        )
        with contextlib.suppress(Exception):
            send_branded_email([user.email], subject, "generic", copy_context)

    _ph = get_posthog_client()
    if _ph:
        _distinct_id = str(user.id) if user else "anonymous"
        _ph.capture(
            distinct_id=_distinct_id,
            event="survey_response_submitted",
            properties={
                "survey_id": str(survey.id),
                "is_anonymous": survey.is_anonymous,
                "answer_count": len(payload.answers),
            },
        )

    return reloaded


@router.get(
    "/{survey_id}/my-responses",
    response_model=list[SurveyResponseOut],
    summary="列出自己的問卷回應",
)
async def list_my_responses(
    survey_id: str,
    session: DbDep,
    user: OptionalUser,
    anon_token: str | None = Query(None, max_length=64),
) -> list[SurveyResponse]:
    survey = await _survey_or_404(survey_id, session)
    try:
        await survey_svc.check_survey_access(session, survey, user)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    if not survey.is_anonymous and user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="請先登入後查看自己的填答"
        )
    return await survey_svc.list_my_responses(
        session,
        survey,
        respondent_id=user.id if user else None,
        anon_token=anon_token,
    )


@router.patch(
    "/{survey_id}/responses/{response_id}",
    response_model=SurveyResponseOut,
    summary="更新自己的問卷回應",
)
async def update_response(
    survey_id: str,
    response_id: uuid.UUID,
    payload: SurveySubmit,
    session: DbDep,
    user: OptionalUser,
) -> SurveyResponse:
    survey = await _survey_or_404(survey_id, session)
    try:
        await survey_svc.check_survey_access(session, survey, user)
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e)) from e
    if not survey.is_anonymous and user is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="請先登入後才能修改填答")
    response = await survey_svc.get_my_response(
        session,
        survey,
        response_id,
        respondent_id=user.id if user else None,
        anon_token=payload.anon_token,
    )
    if response is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到可修改的填答")
    try:
        response = await survey_svc.update_response(
            session,
            survey,
            response,
            respondent_id=user.id if user else None,
            data=payload,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)) from e
    await audit_svc.record(
        session,
        entity_type="survey_response",
        entity_id=str(response.id),
        action="survey.response_update",
        actor_id=str(user.id) if user else None,
        actor_email=user.email if user else None,
        meta={
            "survey_id": str(survey.id),
            "survey_title": survey.title,
            "is_anonymous": survey.is_anonymous,
            "answer_count": len(payload.answers),
        },
        summary=f"更新問卷「{survey.title}」填答",
    )
    await _invalidate_response_caches(user)
    reloaded = await _response_with_answers(session, response.id)

    if payload.email_copy and user and user.email:
        subject, copy_context = survey_svc.render_response_copy_email(
            survey, list(survey.questions), list(reloaded.answers)
        )
        with contextlib.suppress(Exception):
            send_branded_email([user.email], subject, "generic", copy_context)

    _ph = get_posthog_client()
    if _ph:
        _ph.capture(
            distinct_id=str(user.id) if user else "anonymous",
            event="survey_response_updated",
            properties={
                "survey_id": str(survey.id),
                "is_anonymous": survey.is_anonymous,
                "answer_count": len(payload.answers),
            },
        )
    return reloaded


# ── 統計（管理員） ────────────────────────────────────────────────────────────


@router.get(
    "/{survey_id}/stats",
    response_model=SurveyStats,
    summary="取得問卷統計（survey:manage）",
)
async def get_survey_stats(survey_id: str, session: DbDep, user: CurrentUser) -> SurveyStats:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    return await survey_svc.get_survey_stats(session, survey)


@router.get(
    "/{survey_id}/responses",
    response_model=list[SurveyResponseAdminItem],
    summary="列出問卷所有填答記錄（survey:manage）",
)
async def list_survey_responses(
    survey_id: str,
    session: DbDep,
    user: CurrentUser,
    limit: int = Query(1000, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> list[SurveyResponse]:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    return await survey_svc.list_responses(session, survey, limit=limit, offset=offset)


@router.delete(
    "/{survey_id}/responses/{response_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="刪除問卷單筆回應（survey:manage）",
)
async def delete_survey_response(
    survey_id: str,
    response_id: uuid.UUID,
    session: DbDep,
    user: CurrentUser,
) -> None:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    deleted = await survey_svc.delete_response(session, survey, response_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此問卷回應")
    await audit_svc.record(
        session,
        entity_type="survey_response",
        entity_id=str(response_id),
        action="survey.response_delete",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"survey_id": str(survey.id), "survey_title": survey.title},
        summary=f"刪除問卷「{survey.title}」單筆回應",
    )


@router.delete(
    "/{survey_id}/responses",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="清除問卷全部回應（survey:manage）",
)
async def delete_all_survey_responses(
    survey_id: str,
    session: DbDep,
    user: CurrentUser,
) -> None:
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    deleted_count = await survey_svc.delete_all_responses(session, survey)
    await audit_svc.record(
        session,
        entity_type="survey",
        entity_id=str(survey.id),
        action="survey.responses_clear",
        actor_id=str(user.id),
        actor_email=user.email,
        meta={"survey_title": survey.title, "deleted_count": deleted_count},
        summary=f"清除問卷「{survey.title}」全部回應（{deleted_count} 份）",
    )


@router.get(
    "/{survey_id}/export",
    response_class=Response,
    summary="匯出問卷回應為 Excel 試算表（survey:manage）",
    responses={
        200: {"content": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}}}
    },
)
async def export_survey(survey_id: str, session: DbDep, user: CurrentUser) -> Response:
    """下載問卷回應與統計試算表（含「回應明細」與「統計摘要」工作表）。"""
    survey = await _survey_or_404(survey_id, session)
    await _require_survey_manager(session, user, survey.activity_id)
    xlsx_bytes = await survey_svc.build_survey_export(session, survey)
    ascii_name = f"survey_{survey.id}.xlsx"
    utf8_name = quote(f"{survey.title}.xlsx")
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}"
            )
        },
    )
