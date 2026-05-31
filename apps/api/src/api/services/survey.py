"""問卷系統服務層"""

from __future__ import annotations

import html
import io
import json
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.models.org import Position, UserPosition
from api.models.survey import (
    QuestionType,
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
    SurveyStatus,
    ValidationRule,
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

# 可編輯題目／基本資料的問卷狀態：草稿與開放中皆可（已截止／封存則鎖定）
_EDITABLE_STATUSES = {SurveyStatus.DRAFT, SurveyStatus.OPEN}


def _dump_str_list(values: list) -> str | None:
    """序列化字串／UUID 清單為 JSON；空清單回傳 None。"""
    items = [str(v).strip() for v in (values or []) if str(v).strip()]
    return json.dumps(items, ensure_ascii=False) if items else None


def _load_str_list(raw: str | None) -> list[str]:
    """還原 JSON 陣列字串為字串清單。"""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []
    return [str(x) for x in parsed] if isinstance(parsed, list) else []


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
    survey = result.scalar_one_or_none()
    if survey is not None:
        survey.response_count = await _response_count(session, survey.id)
    return survey


async def get_survey_by_identifier(
    session: AsyncSession, identifier: uuid.UUID | str
) -> Survey | None:
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
    survey = result.scalar_one_or_none()
    if survey is not None:
        survey.response_count = await _response_count(session, survey.id)
    return survey


async def list_surveys(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None,
    status: SurveyStatus | None = None,
    public_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> list[Survey]:
    q = (
        select(Survey, func.count(SurveyResponse.id))
        .outerjoin(SurveyResponse, SurveyResponse.survey_id == Survey.id)
        .group_by(Survey.id)
        .order_by(Survey.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if org_id:
        q = q.where(Survey.org_id == org_id)
    if activity_id:
        q = q.where(Survey.activity_id == activity_id)
    if public_only:
        # 公開列表：僅顯示標記為公開且已開放/已截止的問卷（不含草稿、封存）
        q = q.where(
            Survey.is_public == True,  # noqa: E712
            Survey.status.in_([SurveyStatus.OPEN, SurveyStatus.CLOSED]),
        )
    if status:
        q = q.where(Survey.status == status)
    result = await session.execute(q)
    surveys: list[Survey] = []
    for survey, count in result.all():
        survey.response_count = count
        surveys.append(survey)
    return surveys


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
        activity_id=data.activity_id,
        created_by=created_by,
        is_public=data.is_public,
        allowed_org_ids_json=_dump_str_list(data.allowed_org_ids),
        allowed_user_ids_json=_dump_str_list(data.allowed_user_ids),
        allowed_domains_json=_dump_str_list(data.allowed_domains),
    )
    session.add(survey)
    await session.flush()
    return survey


async def update_survey(session: AsyncSession, survey: Survey, *, data: SurveyUpdate) -> Survey:
    if survey.status not in _EDITABLE_STATUSES:
        raise ValueError("已截止或封存的問卷無法修改")
    fields = data.model_dump(exclude_none=True)
    for key in ("allowed_org_ids", "allowed_user_ids", "allowed_domains"):
        if key in fields:
            setattr(survey, f"{key}_json", _dump_str_list(fields.pop(key)))
    for field, value in fields.items():
        setattr(survey, field, value)
    await session.flush()
    return survey


def _email_domain(email: str | None) -> str:
    return email.rsplit("@", 1)[-1].lower() if email and "@" in email else ""


async def check_survey_access(session: AsyncSession, survey: Survey, user: object | None) -> None:
    """驗證填答者是否在問卷開放對象內；不符時拋出 PermissionError。"""
    if survey.is_public:
        return
    if user is None:
        raise PermissionError("此問卷需登入後才能填答")
    org_ids = set(_load_str_list(survey.allowed_org_ids_json))
    user_ids = set(_load_str_list(survey.allowed_user_ids_json))
    domains = {d.lower().lstrip("@") for d in _load_str_list(survey.allowed_domains_json)}
    if not org_ids and not user_ids and not domains:
        return  # 未設限制名單 → 任何登入者皆可填
    if user_ids and str(getattr(user, "id", "")) in user_ids:
        return
    email = (getattr(user, "email", "") or "").lower()
    if domains and _email_domain(email) in domains:
        return
    if org_ids:
        result = await session.execute(
            select(Position.org_id)
            .join(UserPosition, UserPosition.position_id == Position.id)
            .where(UserPosition.user_id == user.id)
        )
        if {str(o) for o in result.scalars().all()} & org_ids:
            return
    raise PermissionError("您不在此問卷的開放填答對象範圍內")


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


def _serialize_option_config(cfg, options: list[str] | None) -> str | None:
    """將 OptionConfig 序列化；保留只引用實際存在於 options 的標記。"""
    if cfg is None:
        return None
    valid = set(options or [])
    exclusive = [o for o in cfg.exclusive if o in valid]
    other = [o for o in cfg.other if o in valid]
    if not exclusive and not other:
        return None
    return json.dumps({"exclusive": exclusive, "other": other}, ensure_ascii=False)


def _load_option_config(raw: str | None) -> dict[str, list[str]]:
    if not raw:
        return {"exclusive": [], "other": []}
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"exclusive": [], "other": []}
    return {
        "exclusive": [str(o) for o in data.get("exclusive", []) if isinstance(o, str)],
        "other": [str(o) for o in data.get("other", []) if isinstance(o, str)],
    }


async def add_question(
    session: AsyncSession, survey: Survey, *, data: SurveyQuestionCreate
) -> SurveyQuestion:
    if survey.status not in _EDITABLE_STATUSES:
        raise ValueError("已截止或封存的問卷無法新增題目")
    question = SurveyQuestion(
        survey_id=survey.id,
        question_text=data.question_text,
        question_type=data.question_type,
        is_required=False if data.question_type in DISPLAY_QUESTION_TYPES else data.is_required,
        options_json=json.dumps(data.options, ensure_ascii=False) if data.options else None,
        option_config_json=_serialize_option_config(data.option_config, data.options),
        min_value=data.min_value,
        max_value=data.max_value,
        placeholder=data.placeholder,
        image_url=data.image_url,
        min_length=data.min_length,
        max_length=data.max_length,
        validation_rule=data.validation_rule.value if data.validation_rule else None,
        min_label=data.min_label,
        max_label=data.max_label,
        condition_json=data.condition.model_dump_json() if data.condition else None,
        order_index=data.order_index,
    )
    session.add(question)
    await session.flush()
    return question


async def update_question(
    session: AsyncSession, question: SurveyQuestion, *, data: SurveyQuestionUpdate
) -> SurveyQuestion:
    survey = await session.get(Survey, question.survey_id)
    if survey and survey.status not in _EDITABLE_STATUSES:
        raise ValueError("已截止或封存的問卷無法修改題目")
    # exclude_unset：只更新呼叫端明確提供的欄位（含明確設為 null 以清除設定）
    fields = data.model_dump(exclude_unset=True)
    if "options" in fields:
        opts = fields.pop("options")
        question.options_json = json.dumps(opts, ensure_ascii=False) if opts else None
    if "option_config" in fields:
        raw_cfg = fields.pop("option_config")
        # 此處取用 dict（model_dump 已將 OptionConfig 攤平）
        current_opts = json.loads(question.options_json) if question.options_json else []
        if raw_cfg is None:
            question.option_config_json = None
        else:
            valid = set(current_opts)
            exclusive = [o for o in raw_cfg.get("exclusive", []) if o in valid]
            other = [o for o in raw_cfg.get("other", []) if o in valid]
            question.option_config_json = (
                json.dumps({"exclusive": exclusive, "other": other}, ensure_ascii=False)
                if (exclusive or other)
                else None
            )
    if "condition" in fields:
        cond = fields.pop("condition")
        question.condition_json = (
            json.dumps(cond, ensure_ascii=False, default=str) if cond else None
        )
    if "validation_rule" in fields:
        rule = fields["validation_rule"]
        fields["validation_rule"] = (
            (rule.value if hasattr(rule, "value") else rule) if rule else None
        )
    for field, value in fields.items():
        setattr(question, field, value)
    await session.flush()
    return question


async def delete_question(session: AsyncSession, question: SurveyQuestion) -> None:
    survey = await session.get(Survey, question.survey_id)
    if survey and survey.status not in _EDITABLE_STATUSES:
        raise ValueError("已截止或封存的問卷無法刪除題目")
    await session.delete(question)
    await session.flush()


# ── 填答 ─────────────────────────────────────────────────────────────────────


_VALIDATION_PATTERNS: dict[str, tuple[re.Pattern[str], str]] = {
    ValidationRule.EMAIL: (re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$"), "電子郵件"),
    ValidationRule.URL: (re.compile(r"^https?://\S+$"), "網址"),
    ValidationRule.PHONE: (re.compile(r"^[0-9+\-() ]{6,20}$"), "電話號碼"),
}


def _validate_text_answer(question: SurveyQuestion, text: str) -> None:
    """依題目的自訂規則驗證文字答案；不符時拋出 ValueError。"""
    label = question.question_text[:30]
    stripped = text.strip()
    if not stripped:
        return  # 必填與否由他處檢查；此處只驗證有填內容的格式
    if question.min_length is not None and len(stripped) < question.min_length:
        raise ValueError(f"題目「{label}」至少需 {question.min_length} 個字")
    if question.max_length is not None and len(stripped) > question.max_length:
        raise ValueError(f"題目「{label}」不可超過 {question.max_length} 個字")
    rule = question.validation_rule
    if not rule:
        return
    if rule == ValidationRule.NUMBER:
        try:
            float(stripped)
        except ValueError:
            raise ValueError(f"題目「{label}」需填寫數字") from None
    elif rule == ValidationRule.INTEGER:
        if not re.fullmatch(r"-?\d+", stripped):
            raise ValueError(f"題目「{label}」需填寫整數")
    else:
        pattern_name = _VALIDATION_PATTERNS.get(rule)
        if pattern_name and not pattern_name[0].match(stripped):
            raise ValueError(f"題目「{label}」格式需為{pattern_name[1]}")


def _evaluate_rule(rule: dict, answers_by_id: dict[uuid.UUID, object]) -> bool:
    """評估單一條件規則。"""
    raw_id = rule.get("question_id")
    if not raw_id:
        return True
    try:
        source_id = uuid.UUID(str(raw_id))
    except ValueError:
        return True
    ans = answers_by_id.get(source_id)
    if ans is None:
        return False  # 來源題目未作答 → 規則不成立
    value = (rule.get("value") or "").strip()
    text = (getattr(ans, "answer_text", None) or "").strip()
    options = getattr(ans, "answer_options", None) or []
    if rule.get("operator") == "contains":
        return value != "" and (value in text or any(value in o for o in options))
    return text == value or value in options


def _evaluate_condition(condition_json: str | None, answers_by_id: dict[uuid.UUID, object]) -> bool:
    """評估題目顯示條件；多規則由上到下依序左結合（且／或）。"""
    if not condition_json:
        return True
    try:
        cond = json.loads(condition_json)
    except (json.JSONDecodeError, TypeError):
        return True
    if not isinstance(cond, dict):
        return True
    rules = cond.get("rules")
    if not rules:
        return True
    result = _evaluate_rule(rules[0], answers_by_id)
    for rule in rules[1:]:
        if rule.get("connector") == "or":
            result = result or _evaluate_rule(rule, answers_by_id)
        else:
            result = result and _evaluate_rule(rule, answers_by_id)
    return result


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
    respondent_email: str | None = None,
) -> SurveyResponse:
    await _check_can_respond(session, survey, respondent_id, data.anon_token)

    # 載入問題
    q_result = await session.execute(
        select(SurveyQuestion).where(SurveyQuestion.survey_id == survey.id)
    )
    questions = {q.id: q for q in q_result.scalars().all()}

    # 驗證必填欄位（略過顯示條件未成立的題目）
    answers_by_q = {a.question_id: a for a in data.answers}
    for q in questions.values():
        if q.question_type in DISPLAY_QUESTION_TYPES:
            continue
        if not _evaluate_condition(q.condition_json, answers_by_q):
            continue
        if q.is_required and q.id not in answers_by_q:
            raise ValueError(f"題目「{q.question_text[:30]}」為必填")

    # 驗證文字題型的自訂規則（字數、格式）
    for q in questions.values():
        if q.question_type in (QuestionType.TEXT, QuestionType.TEXTAREA):
            ans = answers_by_q.get(q.id)
            if ans and ans.answer_text:
                _validate_text_answer(q, ans.answer_text)

    # 驗證多選題的「互斥選項」與排序題的項數範圍
    for q in questions.values():
        ans = answers_by_q.get(q.id)
        if ans is None:
            continue
        if q.question_type == QuestionType.MULTIPLE:
            cfg = _load_option_config(q.option_config_json)
            chosen = list(ans.answer_options or [])
            excl_chosen = [o for o in chosen if o in cfg["exclusive"]]
            if excl_chosen and len(chosen) > len(excl_chosen):
                raise ValueError(
                    f"題目「{q.question_text[:30]}」勾選了互斥選項，不可同時選擇其他項目"
                )
            if cfg["other"] and ans.other_text and not any(o in cfg["other"] for o in chosen):
                ans.other_text = None
        elif q.question_type == QuestionType.RANKING:
            options_list = _load_str_list(q.options_json)
            chosen = [o for o in (ans.answer_options or []) if o in options_list]
            seen: set[str] = set()
            unique = [o for o in chosen if not (o in seen or seen.add(o))]
            ans.answer_options = unique
            min_n = q.min_value or 0
            max_n = q.max_value if q.max_value is not None else len(options_list)
            if q.is_required and len(unique) < max(min_n, 1):
                raise ValueError(f"題目「{q.question_text[:30]}」至少需排序 {max(min_n, 1)} 個項目")
            if unique and len(unique) < min_n:
                raise ValueError(f"題目「{q.question_text[:30]}」至少需排序 {min_n} 個項目")
            if len(unique) > max_n:
                raise ValueError(f"題目「{q.question_text[:30]}」最多只能排序 {max_n} 個項目")

    # 建立回應（匿名問卷不記錄 email，保障匿名性）
    response = SurveyResponse(
        survey_id=survey.id,
        respondent_id=None if survey.is_anonymous else respondent_id,
        anon_token=data.anon_token if survey.is_anonymous else None,
        respondent_email=None if survey.is_anonymous else respondent_email,
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
        if q.question_type == QuestionType.MULTIPLE:
            answer.answer_json = json.dumps(ans.answer_options, ensure_ascii=False)
            cfg = _load_option_config(q.option_config_json)
            if cfg["other"] and any(o in cfg["other"] for o in ans.answer_options):
                answer.other_text = (ans.other_text or "").strip() or None
        elif q.question_type == QuestionType.RANKING:
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
            # 多選題若有「其他」自由輸入，彙整為文字回答清單供管理員瀏覽
            other_texts = [a.other_text for a in answers if a.other_text]
            if other_texts:
                qs.text_answers = other_texts

        elif q.question_type == QuestionType.RANKING:
            # 計算各選項平均排名：第 1 名 = 1 分，越小越優先
            rank_sums: dict[str, float] = {}
            rank_counts: dict[str, int] = {}
            for a in answers:
                if not a.answer_json:
                    continue
                try:
                    ordered = json.loads(a.answer_json)
                except json.JSONDecodeError:
                    continue
                for idx, opt in enumerate(ordered):
                    rank_sums[opt] = rank_sums.get(opt, 0.0) + idx + 1
                    rank_counts[opt] = rank_counts.get(opt, 0) + 1
            # 以平均排名（越低越好）反向轉成「分數」用於長條圖
            # 沿用 option_counts 結構：值為被選次數，方便管理員看「最常被排入名單」
            qs.option_counts = dict(rank_counts)
            qs.text_answers = [
                f"{opt}：平均第 {rank_sums[opt] / rank_counts[opt]:.2f} 名（{rank_counts[opt]} 票）"
                for opt in sorted(rank_sums, key=lambda o: rank_sums[o] / rank_counts[o])
            ]
            qs.suggested_chart = "bar"
            qs.available_charts = ["bar", "list"]

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


# ── 試算表匯出 ────────────────────────────────────────────────────────────────


def _answer_display(answer: SurveyAnswer | None) -> str:
    """把單一答案轉成試算表儲存格的文字。"""
    if answer is None:
        return ""
    if answer.answer_json:
        try:
            opts = json.loads(answer.answer_json)
            if isinstance(opts, list):
                text = "、".join(str(o) for o in opts)
                if answer.other_text:
                    text += f"（其他：{answer.other_text}）"
                return text
        except json.JSONDecodeError:
            pass
    return answer.answer_text or ""


async def build_survey_export(session: AsyncSession, survey: Survey) -> bytes:
    """匯出問卷回應為 Excel（.xlsx），含「回應明細」與「統計摘要」兩個工作表。"""
    import pandas as pd  # 延遲匯入，避免未安裝時影響啟動

    # 可填答題目（排除純顯示區塊），依顯示順序
    q_result = await session.execute(
        select(SurveyQuestion)
        .where(SurveyQuestion.survey_id == survey.id)
        .order_by(SurveyQuestion.order_index)
    )
    questions = [
        q for q in q_result.scalars().all() if q.question_type not in DISPLAY_QUESTION_TYPES
    ]
    col_labels = {q.id: f"Q{i}. {q.question_text}" for i, q in enumerate(questions, start=1)}

    # 回應（含答案）
    r_result = await session.execute(
        select(SurveyResponse)
        .options(selectinload(SurveyResponse.answers))
        .where(SurveyResponse.survey_id == survey.id)
        .order_by(SurveyResponse.submitted_at)
    )
    responses = list(r_result.scalars().all())

    # 工作表 1：回應明細（每列一份回應）
    detail_rows: list[dict[str, object]] = []
    for idx, resp in enumerate(responses, start=1):
        answers_by_q = {a.question_id: a for a in resp.answers}
        row: dict[str, object] = {
            "#": idx,
            "提交時間": resp.submitted_at.strftime("%Y-%m-%d %H:%M") if resp.submitted_at else "",
        }
        for q in questions:
            row[col_labels[q.id]] = _answer_display(answers_by_q.get(q.id))
        detail_rows.append(row)
    detail_df = pd.DataFrame(detail_rows, columns=["#", "提交時間", *col_labels.values()])

    # 工作表 2：統計摘要
    stats = await get_survey_stats(session, survey)
    summary_rows: list[dict[str, object]] = []
    for qs in stats.questions:
        for opt, count in qs.option_counts.items():
            pct = round(count / qs.total_responses * 100, 1) if qs.total_responses else 0
            summary_rows.append(
                {"題目": qs.question_text, "項目": opt, "次數": count, "百分比": f"{pct}%"}
            )
        if qs.average_rating is not None:
            summary_rows.append(
                {
                    "題目": qs.question_text,
                    "項目": "平均分",
                    "次數": round(qs.average_rating, 2),
                    "百分比": "",
                }
            )
        if qs.text_answers:
            summary_rows.append(
                {
                    "題目": qs.question_text,
                    "項目": "文字回答則數",
                    "次數": len(qs.text_answers),
                    "百分比": "",
                }
            )
        if not qs.option_counts and qs.average_rating is None and not qs.text_answers:
            summary_rows.append(
                {
                    "題目": qs.question_text,
                    "項目": "回答數",
                    "次數": qs.total_responses,
                    "百分比": "",
                }
            )
    summary_df = pd.DataFrame(summary_rows, columns=["題目", "項目", "次數", "百分比"])

    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        detail_df.to_excel(writer, index=False, sheet_name="回應明細")
        summary_df.to_excel(writer, index=False, sheet_name="統計摘要")
        for sheet_name in ("回應明細", "統計摘要"):
            ws = writer.sheets[sheet_name]
            for col in ws.columns:
                max_len = max((len(str(cell.value or "")) for cell in col), default=10)
                ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 60)
    return buf.getvalue()


# ── 後台檢視 / 回答副本 ───────────────────────────────────────────────────────


async def list_responses(
    session: AsyncSession, survey: Survey, *, limit: int = 200, offset: int = 0
) -> list[SurveyResponse]:
    """後台檢視用：列出問卷所有填答記錄（含答案，依提交時間新到舊）。"""
    result = await session.execute(
        select(SurveyResponse)
        .options(selectinload(SurveyResponse.answers))
        .where(SurveyResponse.survey_id == survey.id)
        .order_by(SurveyResponse.submitted_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(result.scalars().all())


def render_response_copy_email(
    survey: Survey,
    questions: list[SurveyQuestion],
    answers: list[SurveyAnswer],
) -> tuple[str, dict]:
    """產生「回答副本」品牌信件的主旨與 generic 範本 context。

    題目/回答以排版區塊呈現，套用平台品牌 email 版型（api.email）。
    """
    answers_by_q = {a.question_id: a for a in answers}
    blocks: list[str] = ["<p>感謝您的填答，以下是您本次提交的回答副本。</p>"]
    for q in questions:
        if q.question_type in DISPLAY_QUESTION_TYPES:
            continue
        value = _answer_display(answers_by_q.get(q.id)) or "—"
        blocks.append(
            '<p style="margin:18px 0 2px;color:#64748b;font-size:13px;">'
            f"{html.escape(q.question_text)}</p>"
            '<p style="margin:0;color:#1a1a2e;font-weight:600;">'
            f"{html.escape(value)}</p>"
        )
    context = {
        "heading": f"問卷「{survey.title}」回答副本",
        "body_html": "".join(blocks),
        "preview_text": f"您在問卷「{survey.title}」的填答副本",
    }
    return f"問卷「{survey.title}」回答副本", context
