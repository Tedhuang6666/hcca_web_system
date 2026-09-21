"""問卷系統的 schema 序列化、回應計數、圖片題型與試算表匯出測試。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.org import Org
from api.models.survey import (
    QuestionType,
    Survey,
    SurveyAnswer,
    SurveyResponse,
    SurveyStatus,
)
from api.models.user import User
from api.schemas.survey import (
    SurveyCreate,
    SurveyOut,
    SurveyQuestionCreate,
    SurveyQuestionOut,
    SurveySubmit,
)
from api.services import survey as survey_svc


async def _make_user(db: AsyncSession) -> User:
    user = User(email=f"u-{uuid.uuid4().hex[:8]}@test.edu", display_name="填答者")
    db.add(user)
    await db.flush()
    return user


async def _make_respondent_id(db: AsyncSession) -> uuid.UUID:
    """survey_responses.respondent_id 對 users 有 FK，需真實 user。"""
    return (await _make_user(db)).id


async def _make_draft_survey(db: AsyncSession) -> Survey:
    org = Org(name=f"問卷組織-{uuid.uuid4().hex[:6]}")
    db.add(org)
    await db.flush()
    creator = await _make_user(db)
    return await survey_svc.create_survey(
        db,
        data=SurveyCreate(title=f"測試問卷-{uuid.uuid4().hex[:8]}", org_id=org.id),
        created_by=creator.id,
    )


# ── Schema 序列化 ────────────────────────────────────────────────────────────


async def test_question_out_parses_options_via_typeadapter(db_session: AsyncSession) -> None:
    """FastAPI 以 TypeAdapter 序列化；選項必須能從 options_json 還原。"""
    survey = await _make_draft_survey(db_session)
    question = await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(
            question_text="最喜歡的顏色？",
            question_type=QuestionType.SINGLE,
            options=["紅", "綠", "藍"],
        ),
    )

    out = TypeAdapter(SurveyQuestionOut).validate_python(question, from_attributes=True)
    assert out.options == ["紅", "綠", "藍"]


async def test_survey_out_nested_questions_keep_options(db_session: AsyncSession) -> None:
    """SurveyOut 巢狀題目的選項也要正確序列化。"""
    survey = await _make_draft_survey(db_session)
    await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(
            question_text="多選題",
            question_type=QuestionType.MULTIPLE,
            options=["A", "B"],
        ),
    )
    loaded = await survey_svc.get_survey(db_session, survey.id)

    out = TypeAdapter(SurveyOut).validate_python(loaded, from_attributes=True)
    assert out.questions[0].options == ["A", "B"]


# ── 回應計數 ──────────────────────────────────────────────────────────────────


async def test_get_survey_includes_response_count(db_session: AsyncSession) -> None:
    survey = await _make_draft_survey(db_session)
    for _ in range(3):
        db_session.add(
            SurveyResponse(
                survey_id=survey.id,
                respondent_id=await _make_respondent_id(db_session),
                submitted_at=datetime.now(UTC),
            )
        )
    await db_session.flush()

    loaded = await survey_svc.get_survey(db_session, survey.id)
    assert loaded is not None
    assert loaded.response_count == 3


async def test_list_surveys_includes_response_count(db_session: AsyncSession) -> None:
    survey = await _make_draft_survey(db_session)
    db_session.add(
        SurveyResponse(
            survey_id=survey.id,
            respondent_id=await _make_respondent_id(db_session),
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.flush()

    surveys = await survey_svc.list_surveys(db_session)
    match = next(s for s in surveys if s.id == survey.id)
    assert match.response_count == 1


# ── 圖片題型 ──────────────────────────────────────────────────────────────────


async def test_add_question_stores_image_url(db_session: AsyncSession) -> None:
    survey = await _make_draft_survey(db_session)
    question = await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(
            question_text="附圖題目",
            question_type=QuestionType.TEXT,
            image_url="/uploads/surveys/abc.png",
        ),
    )
    assert question.image_url == "/uploads/surveys/abc.png"


def test_image_question_without_image_is_rejected() -> None:
    with pytest.raises(ValidationError):
        SurveyQuestionCreate(question_type=QuestionType.IMAGE, question_text="")


def test_answerable_question_without_text_is_rejected() -> None:
    with pytest.raises(ValidationError):
        SurveyQuestionCreate(question_type=QuestionType.TEXT, question_text="   ")


def test_multiple_choice_limit_cannot_exceed_option_count() -> None:
    with pytest.raises(ValidationError, match="多選最多項數不可大於選項總數"):
        SurveyQuestionCreate(
            question_text="可選活動",
            question_type=QuestionType.MULTIPLE,
            options=["A", "B"],
            max_value=3,
        )


async def test_submit_response_rejects_empty_required_answer(db_session: AsyncSession) -> None:
    survey = await _make_draft_survey(db_session)
    question = await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(question_text="必填意見", question_type=QuestionType.TEXT),
    )
    survey.status = SurveyStatus.OPEN

    with pytest.raises(ValueError, match="為必填"):
        await survey_svc.submit_response(
            db_session,
            survey,
            respondent_id=await _make_respondent_id(db_session),
            data=SurveySubmit(answers=[{"question_id": question.id, "answer_text": "   "}]),
        )


async def test_submit_response_rejects_answers_above_multiple_choice_limit(
    db_session: AsyncSession,
) -> None:
    survey = await _make_draft_survey(db_session)
    question = await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(
            question_text="最多選兩項",
            question_type=QuestionType.MULTIPLE,
            options=["A", "B", "C"],
            max_value=2,
        ),
    )
    survey.status = SurveyStatus.OPEN

    with pytest.raises(ValueError, match="最多可選 2 個選項"):
        await survey_svc.submit_response(
            db_session,
            survey,
            respondent_id=await _make_respondent_id(db_session),
            data=SurveySubmit(
                answers=[{"question_id": question.id, "answer_options": ["A", "B", "C"]}],
            ),
        )


# ── 回答副本信件 ──────────────────────────────────────────────────────────────


async def test_response_copy_email_includes_questions_options_and_images(
    db_session: AsyncSession,
) -> None:
    survey = await _make_draft_survey(db_session)
    question = await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(
            question_text="最想參加哪一類活動？",
            question_type=QuestionType.SINGLE,
            is_required=True,
            options=["社團博覽會", "校慶晚會"],
            image_url="/uploads/surveys/question.png",
            option_image_sets=[
                ["/uploads/surveys/clubs.png"],
                ["/uploads/surveys/celebration.png"],
            ],
        ),
    )
    response = SurveyResponse(
        survey_id=survey.id,
        respondent_id=await _make_respondent_id(db_session),
        submitted_at=datetime.now(UTC),
    )
    db_session.add(response)
    await db_session.flush()
    answer = SurveyAnswer(
        response_id=response.id,
        question_id=question.id,
        answer_text="社團博覽會",
    )
    db_session.add(answer)
    await db_session.flush()

    subject, context = survey_svc.render_response_copy_email(survey, [question], [answer])
    body_html = context["body_html"]

    assert subject == f"問卷「{survey.title}」回答副本"
    assert "最想參加哪一類活動？" in body_html
    assert "社團博覽會（你的選擇）" in body_html
    assert "校慶晚會" in body_html
    assert "question.png" in body_html
    assert "clubs.png" in body_html
    assert "celebration.png" in body_html
    assert body_html.count("<img") == 3


# ── 試算表匯出 ────────────────────────────────────────────────────────────────


async def test_build_survey_export_returns_xlsx(db_session: AsyncSession) -> None:
    survey = await _make_draft_survey(db_session)
    question = await survey_svc.add_question(
        db_session,
        survey,
        data=SurveyQuestionCreate(question_text="意見", question_type=QuestionType.TEXT),
    )
    survey.status = SurveyStatus.OPEN
    response = SurveyResponse(
        survey_id=survey.id,
        respondent_id=await _make_respondent_id(db_session),
        submitted_at=datetime.now(UTC),
    )
    db_session.add(response)
    await db_session.flush()
    db_session.add(
        SurveyAnswer(response_id=response.id, question_id=question.id, answer_text="很好")
    )
    await db_session.flush()

    data = await survey_svc.build_survey_export(db_session, survey)
    # .xlsx 為 zip 容器，檔頭為 PK
    assert data[:2] == b"PK"
    assert len(data) > 0
