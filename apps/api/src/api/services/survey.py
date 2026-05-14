"""問卷系統服務層"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.survey import (
    QuestionType,
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
    SurveyStatus,
)
from api.schemas.survey import (
    DISPLAY_QUESTION_TYPES,
    QuestionStats,
    SurveyCreate,
    SurveyQuestionCreate,
    SurveyQuestionUpdate,
    SurveyStats,
    SurveySubmit,
    SurveyUpdate,
)

# ── 問卷 CRUD ─────────────────────────────────────────────────────────────────


async def _survey_with_questions(session: AsyncSession, survey_id: uuid.UUID) -> Survey | None:
    result = await session.execute(
        select(Survey)
        .options(selectinload(Survey.questions).selectinload(SurveyQuestion.answers))
        .where(Survey.id == survey_id)
    )
    return result.scalar_one_or_none()


async def get_survey(session: AsyncSession, survey_id: uuid.UUID) -> Survey | None:
    result = await session.execute(
        select(Survey).options(selectinload(Survey.questions)).where(Survey.id == survey_id)
    )
    return result.scalar_one_or_none()


async def get_survey_by_identifier(session: AsyncSession, identifier: uuid.UUID | str) -> Survey | None:
    if isinstance(identifier, uuid.UUID):
        return await get_survey(session, identifier)
    try:
        return await get_survey(session, uuid.UUID(identifier))
    except ValueError:
        pass
    result = await session.execute(
        select(Survey)
        .options(selectinload(Survey.questions))
        .where(Survey.title == identifier)
        .order_by((Survey.status == SurveyStatus.OPEN).desc(), Survey.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def list_surveys(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    status: SurveyStatus | None = None,
    limit: int = 20,
    offset: int = 0,
) -> list[Survey]:
    q = select(Survey).order_by(Survey.created_at.desc()).limit(limit).offset(offset)
    if org_id:
        q = q.where(Survey.org_id == org_id)
    if status:
        q = q.where(Survey.status == status)
    result = await session.execute(q)
    return list(result.scalars().all())


async def _response_count(session: AsyncSession, survey_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count()).where(SurveyResponse.survey_id == survey_id)
    )
    return result.scalar_one()


async def create_survey(
    session: AsyncSession, *, data: SurveyCreate, created_by: uuid.UUID
) -> Survey:
    survey = Survey(
        title=data.title,
        description=data.description,
        is_anonymous=data.is_anonymous,
        allow_multiple=data.allow_multiple,
        opens_at=data.opens_at,
        closes_at=data.closes_at,
        org_id=data.org_id,
        created_by=created_by,
    )
    session.add(survey)
    await session.flush()
    return survey


async def update_survey(session: AsyncSession, survey: Survey, *, data: SurveyUpdate) -> Survey:
    if survey.status != SurveyStatus.DRAFT:
        raise ValueError("只有草稿狀態的問卷才能修改基本資料")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(survey, field, value)
    await session.flush()
    return survey


async def open_survey(session: AsyncSession, survey: Survey) -> Survey:
    if survey.status != SurveyStatus.DRAFT:
        raise ValueError("只有草稿可以開放填答")
    if not any(q.question_type not in DISPLAY_QUESTION_TYPES for q in survey.questions):
        raise ValueError("問卷至少需要一個可填答題目才能開放")
    survey.status = SurveyStatus.OPEN
    await session.flush()
    return survey


async def close_survey(session: AsyncSession, survey: Survey) -> Survey:
    if survey.status != SurveyStatus.OPEN:
        raise ValueError("只有開放中的問卷才能關閉")
    survey.status = SurveyStatus.CLOSED
    await session.flush()
    return survey


async def archive_survey(session: AsyncSession, survey: Survey) -> Survey:
    if survey.status == SurveyStatus.ARCHIVED:
        raise ValueError("問卷已封存")
    survey.status = SurveyStatus.ARCHIVED
    await session.flush()
    return survey


# ── 題目 CRUD ─────────────────────────────────────────────────────────────────


async def add_question(
    session: AsyncSession, survey: Survey, *, data: SurveyQuestionCreate
) -> SurveyQuestion:
    if survey.status != SurveyStatus.DRAFT:
        raise ValueError("只有草稿問卷才能新增題目")
    question = SurveyQuestion(
        survey_id=survey.id,
        question_text=data.question_text,
        question_type=data.question_type,
        is_required=False if data.question_type in DISPLAY_QUESTION_TYPES else data.is_required,
        options_json=json.dumps(data.options, ensure_ascii=False) if data.options else None,
        min_value=data.min_value,
        max_value=data.max_value,
        placeholder=data.placeholder,
        order_index=data.order_index,
    )
    session.add(question)
    await session.flush()
    return question


async def update_question(
    session: AsyncSession, question: SurveyQuestion, *, data: SurveyQuestionUpdate
) -> SurveyQuestion:
    survey = await session.get(Survey, question.survey_id)
    if survey and survey.status != SurveyStatus.DRAFT:
        raise ValueError("只有草稿問卷才能修改題目")
    fields = data.model_dump(exclude_none=True)
    if "options" in fields:
        question.options_json = json.dumps(fields.pop("options"), ensure_ascii=False)
    for field, value in fields.items():
        setattr(question, field, value)
    await session.flush()
    return question


async def delete_question(session: AsyncSession, question: SurveyQuestion) -> None:
    survey = await session.get(Survey, question.survey_id)
    if survey and survey.status != SurveyStatus.DRAFT:
        raise ValueError("只有草稿問卷才能刪除題目")
    await session.delete(question)
    await session.flush()


# ── 填答 ─────────────────────────────────────────────────────────────────────


async def _check_can_respond(
    session: AsyncSession,
    survey: Survey,
    respondent_id: uuid.UUID | None,
    anon_token: str | None,
) -> None:
    """驗證是否可以填答（檢查重複、時間範圍）"""
    now = datetime.now(UTC)

    if survey.status != SurveyStatus.OPEN:
        raise ValueError("此問卷目前不開放填答")
    if survey.opens_at and now < survey.opens_at:
        raise ValueError("問卷尚未開放")
    if survey.closes_at and now > survey.closes_at:
        raise ValueError("問卷已截止")

    if survey.allow_multiple:
        return  # 允許重複填答，不做唯一性檢查

    # 非匿名：檢查 user 是否已填答
    if not survey.is_anonymous and respondent_id:
        dup = await session.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == survey.id,
                SurveyResponse.respondent_id == respondent_id,
            )
        )
        if dup.scalar_one_or_none():
            raise ValueError("您已填答過此問卷")

    # 匿名：以 token 檢查
    if survey.is_anonymous and anon_token:
        dup = await session.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == survey.id,
                SurveyResponse.anon_token == anon_token,
            )
        )
        if dup.scalar_one_or_none():
            raise ValueError("此 token 已填答過此問卷")


async def submit_response(
    session: AsyncSession,
    survey: Survey,
    *,
    respondent_id: uuid.UUID | None,
    data: SurveySubmit,
) -> SurveyResponse:
    await _check_can_respond(session, survey, respondent_id, data.anon_token)

    # 載入問題
    q_result = await session.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == survey.id)
    )
    questions = {q.id: q for q in q_result.scalars().all()}

    # 驗證必填欄位
    answered_ids = {a.question_id for a in data.answers}
    for q in questions.values():
        if q.question_type in DISPLAY_QUESTION_TYPES:
            continue
        if q.is_required and q.id not in answered_ids:
            raise ValueError(f"題目「{q.question_text[:30]}」為必填")

    # 建立回應
    response = SurveyResponse(
        survey_id=survey.id,
        respondent_id=None if survey.is_anonymous else respondent_id,
        anon_token=data.anon_token if survey.is_anonymous else None,
        submitted_at=datetime.now(UTC),
    )
    session.add(response)
    await session.flush()

    # 儲存各題答案
    for ans in data.answers:
        q = questions.get(ans.question_id)
        if q is None:
            continue
        if q.question_type in DISPLAY_QUESTION_TYPES:
            continue
        answer = SurveyAnswer(
            response_id=response.id,
            question_id=ans.question_id,
        )
        if q.question_type in (QuestionType.MULTIPLE,):
            answer.answer_json = json.dumps(ans.answer_options, ensure_ascii=False)
        elif q.question_type == QuestionType.SINGLE:
            answer.answer_text = ans.answer_options[0] if ans.answer_options else ans.answer_text
        else:
            answer.answer_text = ans.answer_text
        session.add(answer)

    await session.flush()
    return response


# ── 統計 ─────────────────────────────────────────────────────────────────────


async def get_survey_stats(session: AsyncSession, survey: Survey) -> SurveyStats:
    """計算問卷各題統計資料（管理員使用）"""
    # 題目
    q_result = await session.execute(
        select(SurveyQuestion)
        .where(SurveyQuestion.survey_id == survey.id)
        .order_by(SurveyQuestion.order_index)
    )
    questions = list(q_result.scalars().all())

    # 回應總數
    total_result = await session.execute(
        select(func.count()).where(SurveyResponse.survey_id == survey.id)
    )
    total = total_result.scalar_one()

    # 各題統計
    question_stats: list[QuestionStats] = []
    for q in questions:
        if q.question_type in DISPLAY_QUESTION_TYPES:
            continue
        # 此題所有答案
        a_result = await session.execute(
            select(SurveyAnswer)
            .join(SurveyResponse, SurveyAnswer.response_id == SurveyResponse.id)
            .where(SurveyResponse.survey_id == survey.id)
            .where(SurveyAnswer.question_id == q.id)
        )
        answers = list(a_result.scalars().all())

        qs = QuestionStats(
            question_id=q.id,
            question_text=q.question_text,
            question_type=q.question_type,
            total_responses=len(answers),
        )

        if q.question_type in (QuestionType.SINGLE, QuestionType.MULTIPLE):
            counts: dict[str, int] = {}
            for a in answers:
                if a.answer_json:
                    try:
                        opts = json.loads(a.answer_json)
                        for opt in opts:
                            counts[opt] = counts.get(opt, 0) + 1
                    except json.JSONDecodeError:
                        pass
                elif a.answer_text:
                    counts[a.answer_text] = counts.get(a.answer_text, 0) + 1
            qs.option_counts = counts
            qs.suggested_chart = "pie" if len(counts) <= 5 else "bar"
            qs.available_charts = ["bar", "pie"]

        elif q.question_type == QuestionType.RATING:
            values = []
            for a in answers:
                try:
                    v = float(a.answer_text or "")
                    values.append(v)
                except (ValueError, TypeError):
                    pass
            qs.average_rating = sum(values) / len(values) if values else None
            qs.option_counts = {
                str(n): sum(1 for value in values if int(value) == n)
                for n in range(q.min_value or 1, (q.max_value or 5) + 1)
            }
            qs.suggested_chart = "bar"
            qs.available_charts = ["bar", "pie"]

        elif q.question_type == QuestionType.DATE:
            qs.text_answers = [a.answer_text for a in answers if a.answer_text]
            qs.suggested_chart = "list"
            qs.available_charts = ["list"]

        else:  # TEXT / TEXTAREA
            qs.text_answers = [a.answer_text for a in answers if a.answer_text]
            qs.suggested_chart = "list"
            qs.available_charts = ["list"]

        question_stats.append(qs)

    return SurveyStats(
        survey_id=survey.id,
        title=survey.title,
        total_responses=total,
        questions=question_stats,
    )
