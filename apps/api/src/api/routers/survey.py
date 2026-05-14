"""問卷系統 Router - 問卷管理 / 題目 / 填答 / 統計"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_permission
from api.models.survey import Survey, SurveyQuestion, SurveyStatus
from api.models.user import User
from api.schemas.survey import (
    SurveyCreate,
    SurveyListItem,
    SurveyOut,
    SurveyQuestionCreate,
    SurveyQuestionOut,
    SurveyQuestionUpdate,
    SurveyResponseOut,
    SurveyStats,
    SurveySubmit,
    SurveyUpdate,
)
from api.services import audit as audit_svc
from api.services import survey as survey_svc

router = APIRouter(prefix="/surveys", tags=["問卷系統"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]


# ── 輔助 ──────────────────────────────────────────────────────────────────────


async def _survey_or_404(survey_id: uuid.UUID | str, session: DbDep) -> Survey:
    s = await survey_svc.get_survey_by_identifier(session, survey_id)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此問卷")
    return s


async def _question_or_404(question_id: uuid.UUID, session: DbDep) -> SurveyQuestion:
    from sqlalchemy import select

    result = await session.execute(select(SurveyQuestion).where(SurveyQuestion.id == question_id))
    q = result.scalar_one_or_none()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此題目")
    return q


# ── 問卷 CRUD ─────────────────────────────────────────────────────────────────


@router.get("/", response_model=list[SurveyListItem], summary="列出問卷")
async def list_surveys(
    session: DbDep,
    _: CurrentUser,
    org_id: uuid.UUID | None = Query(None),
    status_filter: SurveyStatus | None = Query(None, alias="status"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> list[Survey]:
    return await survey_svc.list_surveys(
        session, org_id=org_id, status=status_filter, limit=limit, offset=offset
    )


@router.get("/{survey_id}", response_model=SurveyOut, summary="取得問卷詳細（含題目）")
async def get_survey(survey_id: str, session: DbDep, _: CurrentUser) -> Survey:
    return await _survey_or_404(survey_id, session)


@router.get("/public/{survey_id}", response_model=SurveyOut, summary="公開取得開放問卷")
async def get_public_survey(survey_id: str, session: DbDep) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    if survey.status not in (SurveyStatus.OPEN, SurveyStatus.CLOSED):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此問卷")
    return survey


@router.post(
    "/",
    response_model=SurveyOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增問卷",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def create_survey(payload: SurveyCreate, session: DbDep, user: CurrentUser) -> Survey:
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
            "is_anonymous": survey.is_anonymous,
            "allow_multiple": survey.allow_multiple,
            "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
            "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
        },
        summary=f"建立問卷「{survey.title}」",
    )
    return await _survey_or_404(survey.id, session)


@router.patch(
    "/{survey_id}",
    response_model=SurveyOut,
    summary="更新問卷基本資料（草稿限定）",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def update_survey(
    survey_id: str, payload: SurveyUpdate, session: DbDep, user: CurrentUser
) -> Survey:
    survey = await _survey_or_404(survey_id, session)
    before = {
        "title": survey.title,
        "description": survey.description,
        "is_anonymous": survey.is_anonymous,
        "allow_multiple": survey.allow_multiple,
        "opens_at": survey.opens_at.isoformat() if survey.opens_at else None,
        "closes_at": survey.closes_at.isoformat() if survey.closes_at else None,
    }
    try:
        survey = await survey_svc.update_survey(session, survey, data=payload)
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
            },
        },
        summary=f"更新問卷「{survey.title}」",
    )
    return survey


@router.post(
    "/{survey_id}/open",
    response_model=SurveyOut,
    summary="開放問卷填答",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def open_survey(survey_id: str, session: DbDep, user: CurrentUser) -> Survey:
    survey = await _survey_or_404(survey_id, session)
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
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def close_survey(survey_id: str, session: DbDep, user: CurrentUser) -> Survey:
    survey = await _survey_or_404(survey_id, session)
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
    summary="新增題目（草稿限定）",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def add_question(
    survey_id: str, payload: SurveyQuestionCreate, session: DbDep, user: CurrentUser
) -> SurveyQuestion:
    survey = await _survey_or_404(survey_id, session)
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
    summary="更新題目（草稿限定）",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def update_question(
    question_id: uuid.UUID, payload: SurveyQuestionUpdate, session: DbDep, user: CurrentUser
) -> SurveyQuestion:
    question = await _question_or_404(question_id, session)
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
    summary="刪除題目（草稿限定）",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def delete_question(question_id: uuid.UUID, session: DbDep, user: CurrentUser) -> None:
    question = await _question_or_404(question_id, session)
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
    user: CurrentUser,
) -> object:
    survey = await _survey_or_404(survey_id, session)
    try:
        response = await survey_svc.submit_response(
            session,
            survey,
            respondent_id=user.id,
            data=payload,
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
        actor_id=str(user.id),
        actor_email=user.email,
        meta={
            "survey_id": str(survey.id),
            "survey_title": survey.title,
            "is_anonymous": survey.is_anonymous,
            "answer_count": len(payload.answers),
        },
        summary=f"提交問卷「{survey.title}」填答",
    )

    # 重新載入含答案的回應
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from api.models.survey import SurveyResponse

    result = await session.execute(
        select(SurveyResponse)
        .options(selectinload(SurveyResponse.answers))
        .where(SurveyResponse.id == response.id)
    )
    return result.scalar_one()


# ── 統計（管理員） ────────────────────────────────────────────────────────────


@router.get(
    "/{survey_id}/stats",
    response_model=SurveyStats,
    summary="取得問卷統計（survey:manage）",
    dependencies=[Depends(require_permission(PermissionCode.SURVEY_MANAGE))],
)
async def get_survey_stats(survey_id: str, session: DbDep, _: CurrentUser) -> SurveyStats:
    survey = await _survey_or_404(survey_id, session)
    return await survey_svc.get_survey_stats(session, survey)
