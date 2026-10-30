"""大量題目、角色與報帳品項的查詢數及資料範圍回歸。"""

import uuid
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select

from api.core.clock import local_today
from api.models.document import (
    Document,
    DocumentClassification,
    DocumentRecipient,
    DocumentVisibility,
    RecipientType,
)
from api.models.finance import (
    ChartAccount,
    ExpenseClaimItem,
    ExpenseClaimItemEvidence,
    FinanceBudget,
    FinanceBudgetNode,
    FiscalPeriod,
    FundAccount,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.models.person import Person, PersonAffiliation, PersonAffiliationKind
from api.models.school_class import ClassRoleBinding
from api.models.survey import QuestionType, Survey, SurveyAnswer, SurveyQuestion, SurveyResponse
from api.routers import finance_ledger
from api.schemas.finance import ExpenseClaimCreate
from api.schemas.school_class import SchoolClassCreate
from api.services import finance_journal, school_class
from api.services import permission as permission_svc
from api.services import survey as survey_svc
from api.services.document._access import build_document_list_items
from api.services.finance_core import initialize_ledger


@pytest.fixture
async def query_counter(db_session):
    connection = (await db_session.connection()).sync_connection

    @contextmanager
    def count():
        statements = []

        def on_query(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        event.listen(connection, "before_cursor_execute", on_query)
        try:
            yield statements
        finally:
            event.remove(connection, "before_cursor_execute", on_query)

    return count


@pytest.mark.parametrize("question_count", [1, 40])
async def test_survey_statistics_load_answers_in_batches(
    db_session, admin_user, query_counter, question_count, record_property
):
    org = Org(name="問卷統計效能")
    db_session.add(org)
    await db_session.flush()
    survey = Survey(title="統計", org_id=org.id, created_by=admin_user.id)
    other = Survey(title="其他問卷", org_id=org.id, created_by=admin_user.id)
    db_session.add_all([survey, other])
    await db_session.flush()
    questions = [
        SurveyQuestion(
            survey_id=survey.id,
            question_text=f"問題{index}",
            question_type=QuestionType.SINGLE,
            order_index=index,
        )
        for index in range(question_count)
    ]
    questions.extend(
        [
            SurveyQuestion(survey_id=survey.id, question_text="未作答", order_index=question_count),
            SurveyQuestion(
                survey_id=survey.id, question_text="說明", question_type=QuestionType.SECTION_TEXT
            ),
        ]
    )
    responses = [
        SurveyResponse(
            survey_id=survey.id, respondent_id=admin_user.id, submitted_at=datetime.now(UTC)
        ),
        SurveyResponse(survey_id=survey.id, submitted_at=datetime.now(UTC)),
        SurveyResponse(survey_id=other.id, submitted_at=datetime.now(UTC)),
    ]
    db_session.add_all([*questions, *responses])
    await db_session.flush()
    for question in questions[:question_count]:
        db_session.add_all(
            [
                SurveyAnswer(response_id=responses[0].id, question_id=question.id, answer_text="A"),
                SurveyAnswer(response_id=responses[1].id, question_id=question.id, answer_text="B"),
                SurveyAnswer(
                    response_id=responses[2].id, question_id=question.id, answer_text="不應納入"
                ),
            ]
        )
    await db_session.flush()
    user_id = admin_user.id
    db_session.expunge_all()
    with query_counter() as statements:
        stats = await survey_svc.get_survey_stats(db_session, survey)
    record_property("query_count", len(statements))
    assert len(statements) <= 5
    assert stats.total_responses == 2
    assert len(stats.questions) == question_count + 1
    for question in stats.questions[:question_count]:
        assert question.option_counts == {"A": 1, "B": 1}
        assert [item.user_id for item in question.option_respondents["A"]] == [user_id]
        assert "B" not in question.option_respondents
    assert stats.questions[-1].total_responses == 0


@pytest.mark.parametrize("role_count", [1, 30])
async def test_class_roles_batch_holders_and_preserve_tenure(
    db_session, admin_user, query_counter, role_count, record_property
):
    sc = await school_class.create_class(
        db_session,
        data=SchoolClassCreate(academic_year=115, class_code="101"),
        created_by=admin_user.id,
    )
    expected_roles = set()
    for index in range(role_count):
        position = Position(org_id=sc.org_id, name=f"角色{index}")
        person = Person(display_name=f"未連結同學{index}")
        db_session.add_all([position, person])
        await db_session.flush()
        role_key = f"custom_{index}"
        expected_roles.add(role_key)
        db_session.add_all(
            [
                ClassRoleBinding(class_id=sc.id, role_key=role_key, position_id=position.id),
                Permission(position_id=position.id, code="custom:view"),
                UserPosition(
                    user_id=admin_user.id, position_id=position.id, start_date=local_today()
                ),
                UserPosition(
                    user_id=admin_user.id,
                    position_id=position.id,
                    start_date=local_today() + timedelta(days=1),
                ),
                PersonAffiliation(
                    person_id=person.id,
                    class_id=sc.id,
                    position_id=position.id,
                    kind=PersonAffiliationKind.CLASS_ROLE,
                    status="pending_user",
                ),
                PersonAffiliation(
                    person_id=person.id,
                    class_id=sc.id,
                    position_id=position.id,
                    kind=PersonAffiliationKind.CLASS_ROLE,
                    status="ended",
                ),
            ]
        )
    await db_session.flush()
    db_session.expunge_all()
    with query_counter() as statements:
        rows = await school_class.list_class_roles(db_session, sc)
    record_property("query_count", len(statements))
    assert len(statements) <= 9
    custom_rows = [row for row in rows if row["role_key"] in expected_roles]
    assert len(custom_rows) == role_count
    for row in custom_rows:
        assert row["permission_codes"] == ["custom:view"]
        assert len(row["holders"]) == 1
        assert len(row["person_holders"]) == 1
        assert row["person_holders"][0]["status"] == "pending_user"


@pytest.fixture
async def claim_batch(db_session, admin_user, item_count):
    org = Org(name="報帳查詢效能")
    db_session.add(org)
    await db_session.flush()
    ledger = await initialize_ledger(db_session, org.id, "查詢效能帳本")
    period = FiscalPeriod(
        ledger_id=ledger.id, name="年度", starts_on=date(2026, 1, 1), ends_on=date(2026, 12, 31)
    )
    db_session.add(period)
    await db_session.flush()
    budget = FinanceBudget(ledger_id=ledger.id, period_id=period.id, name="預算")
    db_session.add(budget)
    await db_session.flush()
    nodes = [
        FinanceBudgetNode(budget_id=budget.id, name=f"條目{index}") for index in range(item_count)
    ]
    db_session.add_all(nodes)
    await db_session.flush()
    fund = await db_session.scalar(
        select(FundAccount).where(FundAccount.ledger_id == ledger.id).limit(1)
    )
    account = await db_session.scalar(
        select(ChartAccount).where(ChartAccount.ledger_id == ledger.id, ChartAccount.code == "5101")
    )
    body = ExpenseClaimCreate(
        period_id=period.id,
        entry_date=date(2026, 10, 1),
        fund_account_id=fund.id,
        expense_account_id=account.id,
        description="效能報帳",
        items=[
            {
                "name": node.name,
                "unit_price": 100,
                "quantity": 1,
                "budget_node_id": node.id,
                "evidence": [
                    {
                        "storage_key": f"finance/evidence/{ledger.id}/{uuid.uuid4().hex}.pdf",
                        "filename": "receipt.pdf",
                        "content_type": "application/pdf",
                        "file_size": 100,
                    }
                ],
            }
            for node in nodes
        ],
    )
    return ledger.id, admin_user.id, body, nodes


@pytest.mark.parametrize("item_count", [1, 50])
@pytest.mark.parametrize("operation", ["create", "update"])
async def test_claim_items_batch_reads_and_writes(
    db_session, claim_batch, item_count, operation, query_counter, record_property
):
    ledger_id, user_id, body, _ = claim_batch
    entry_id = None
    if operation == "update":
        entry_id = (
            await finance_journal.create_expense_claim(db_session, ledger_id, body, user_id)
        ).id
    db_session.expunge_all()
    entry = await db_session.get(JournalEntry, entry_id) if entry_id else None
    with query_counter() as statements:
        if operation == "create":
            entry = await finance_journal.create_expense_claim(db_session, ledger_id, body, user_id)
        else:
            entry = await finance_journal.update_expense_claim(db_session, entry, body, user_id)
    record_property("query_count", len(statements))
    assert len(statements) <= 20, (
        f"{operation}: {item_count} items used {len(statements)} statements"
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ExpenseClaimItem)
            .where(ExpenseClaimItem.journal_entry_id == entry.id)
        )
        == item_count
    )
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(ExpenseClaimItemEvidence)
            .join(ExpenseClaimItem)
            .where(ExpenseClaimItem.journal_entry_id == entry.id)
        )
        == item_count
    )


@pytest.mark.parametrize("item_count", [1])
@pytest.mark.parametrize("invalid", ["missing", "period", "ledger", "parent"])
async def test_batch_claim_validation_keeps_scope_and_leaf_checks(db_session, claim_batch, invalid):
    ledger_id, user_id, body, nodes = claim_batch
    if invalid == "missing":
        body.items[0].budget_node_id = uuid.uuid4()
        message = "預算條目不存在"
    elif invalid in {"period", "ledger"}:
        target_ledger_id = ledger_id
        if invalid == "ledger":
            org = Org(name="其他帳本組織")
            db_session.add(org)
            await db_session.flush()
            target_ledger_id = (await initialize_ledger(db_session, org.id, "其他帳本")).id
        period = FiscalPeriod(
            ledger_id=target_ledger_id,
            name="其他年度",
            starts_on=date(2025, 1, 1),
            ends_on=date(2025, 12, 31),
        )
        db_session.add(period)
        await db_session.flush()
        budget = FinanceBudget(ledger_id=target_ledger_id, period_id=period.id, name="其他期間預算")
        db_session.add(budget)
        await db_session.flush()
        node = FinanceBudgetNode(budget_id=budget.id, name="跨期間條目")
        db_session.add(node)
        await db_session.flush()
        body.items[0].budget_node_id = node.id
        message = "預算條目不屬於此帳本或會計期間"
    else:
        db_session.add(
            FinanceBudgetNode(budget_id=nodes[0].budget_id, parent_id=nodes[0].id, name="子條目")
        )
        await db_session.flush()
        message = "報帳只能對應最末層預算條目"
    with pytest.raises(HTTPException) as exc:
        await finance_journal.create_expense_claim(db_session, ledger_id, body, user_id)
    assert (exc.value.status_code, exc.value.detail) == (400, message)


@pytest.mark.parametrize("document_count", [1, 40])
async def test_sensitive_document_lists_share_lookups_within_one_request(
    db_session, admin_user, make_user, query_counter, document_count, record_property
):
    viewer = await make_user()
    orgs = [Org(name="受文機關"), Org(name="發文機關")]
    db_session.add_all(orgs)
    await db_session.flush()
    position = Position(org_id=orgs[0].id, name="受文者職位")
    db_session.add(position)
    await db_session.flush()
    tenure = UserPosition(
        user_id=viewer.id,
        position_id=position.id,
        start_date=local_today() - timedelta(days=1),
    )
    docs = [
        Document(
            serial_number=f"DOC-{uuid.uuid4().hex[:16]}",
            title="密件",
            org_id=orgs[1].id,
            created_by=admin_user.id,
            classification=DocumentClassification.CONFIDENTIAL,
            visibility_level=DocumentVisibility.ORG_ONLY,
        )
        for _ in range(document_count)
    ]
    db_session.add_all([tenure, *docs])
    await db_session.flush()
    db_session.add_all(
        [
            DocumentRecipient(
                document_id=doc.id,
                name="機關受文者",
                recipient_type=RecipientType.MAIN,
                target_org_id=orgs[0].id,
            )
            for doc in docs
        ]
    )
    await db_session.flush()
    viewer_id, tenure_id = viewer.id, tenure.id
    db_session.expunge_all()
    with query_counter() as statements:
        items = await build_document_list_items(db_session, docs, viewer_id=viewer_id)
    record_property("query_count", len(statements))
    assert len(statements) <= 4
    assert len(items) == document_count
    assert all(not item.is_redacted for item in items)

    # 下一次請求必須重新檢查已失效的任期。
    ended = await db_session.get(UserPosition, tenure_id)
    ended.end_date = local_today() - timedelta(days=1)
    ended.start_date = ended.end_date - timedelta(days=1)
    await db_session.flush()
    restricted = await build_document_list_items(db_session, docs, viewer_id=viewer_id)
    assert all(item.is_redacted for item in restricted)
    with query_counter() as bypass_statements:
        revealed = await build_document_list_items(
            db_session, docs, viewer_id=viewer_id, reveal_sensitive=True
        )
    assert not bypass_statements
    assert all(not item.is_redacted for item in revealed)


@pytest.mark.parametrize("org_count", [1, 40])
async def test_org_permission_filters_are_batched_and_keep_tenure_and_inheritance(
    db_session, admin_user, make_user, query_counter, org_count, record_property
):
    user = await make_user()
    user_id = user.id
    today = local_today()
    root = Org(name="上級", default_permission_codes=["finance:view"])
    db_session.add(root)
    await db_session.flush()
    expected = set()
    for index in range(org_count + 3):
        org = Org(name=f"組織{index}", parent_id=root.id)
        db_session.add(org)
        await db_session.flush()
        position = Position(org_id=org.id, name="無個別權限的職位")
        db_session.add(position)
        await db_session.flush()
        if index < org_count:
            expected.add(org.id)
        db_session.add(
            UserPosition(
                user_id=user_id if index != org_count + 2 else admin_user.id,
                position_id=position.id,
                start_date=today + timedelta(days=1)
                if index == org_count
                else today - timedelta(days=2),
                end_date=today - timedelta(days=1) if index == org_count + 1 else None,
            )
        )
    await db_session.flush()
    db_session.expunge_all()
    with query_counter() as statements:
        actual = await permission_svc.get_user_org_ids_with_permission(
            db_session, user_id, "finance:view"
        )
    record_property("query_count", len(statements))
    assert len(statements) <= 2
    assert set(actual) == expected
    with query_counter() as any_statements:
        any_actual = await permission_svc.get_user_org_ids_with_any_permission(
            db_session, user_id, {"finance:view", "other:permission"}
        )
    assert len(any_statements) <= 2
    assert set(any_actual) == expected
    assert (
        await permission_svc.get_user_org_ids_with_any_permission(db_session, user_id, set()) == []
    )


@pytest.mark.parametrize("item_count", [1])
@pytest.mark.parametrize("journal_count", [1, 40, 501])
async def test_journal_list_batches_lines_creators_and_evidence(
    db_session, admin_user, claim_batch, query_counter, journal_count, record_property
):
    ledger_id, user_id, body, _ = claim_batch
    first = await finance_journal.create_expense_claim(db_session, ledger_id, body, user_id)
    template_lines = list(
        await db_session.scalars(select(JournalLine).where(JournalLine.entry_id == first.id))
    )
    entries = [first]
    for index in range(journal_count - 1):
        entry = JournalEntry(
            ledger_id=ledger_id,
            period_id=body.period_id,
            entry_date=body.entry_date,
            created_by_id=user_id,
            description=f"傳票{index}",
            source_type="expense_claim",
            created_at=datetime(2026, 10, 1, tzinfo=UTC) + timedelta(seconds=index),
        )
        entries.append(entry)
        db_session.add(entry)
    await db_session.flush()
    db_session.add_all(
        [
            JournalLine(
                entry_id=entry.id, account_id=line.account_id, debit=line.debit, credit=line.credit
            )
            for entry in entries[1:]
            for line in template_lines
        ]
    )
    await db_session.flush()
    expected_ids = [
        entry.id for entry in sorted(entries, key=lambda row: row.created_at, reverse=True)
    ]
    first_id = first.id
    db_session.expunge_all()
    with query_counter() as statements:
        result = await finance_ledger.list_journals(ledger_id, db_session, admin_user)
    record_property("query_count", len(statements))
    assert len(statements) <= 1 + 3 * ((journal_count + 499) // 500)
    assert [row.id for row in result] == expected_ids
    assert all(len(row.lines) == 2 for row in result)
    assert [row.id for row in result if row.evidence_complete] == [first_id]


@pytest.mark.parametrize("item_count", [1])
async def test_opening_balance_batch_keeps_only_posted_asset_adjustments(db_session, claim_batch):
    ledger_id, user_id, body, _ = claim_batch
    asset_id = await db_session.scalar(
        select(FundAccount.chart_account_id).where(FundAccount.id == body.fund_account_id)
    )
    opening = JournalEntry(
        ledger_id=ledger_id,
        period_id=body.period_id,
        entry_date=body.entry_date,
        created_by_id=user_id,
        description="期初",
        source_type="manual_entry",
        source_event="opening",
    )
    db_session.add(opening)
    await db_session.flush()
    entries = [opening]
    for status, amount in [(JournalStatus.POSTED, 25), (JournalStatus.DRAFT, 99)]:
        adjustment = JournalEntry(
            ledger_id=ledger_id,
            period_id=body.period_id,
            entry_date=body.entry_date,
            created_by_id=user_id,
            description="期初調整",
            source_type="manual_entry",
            source_event=f"opening_adjustment:{status}",
            source_id=opening.id,
            status=status,
        )
        db_session.add(adjustment)
        await db_session.flush()
        db_session.add(
            JournalLine(entry_id=adjustment.id, account_id=asset_id, debit=amount, credit=0)
        )
        entries.append(adjustment)
    db_session.add(JournalLine(entry_id=opening.id, account_id=asset_id, debit=100, credit=0))
    await db_session.flush()
    rows = await finance_journal.journals_with_lines(db_session, entries)
    assert rows[0]["effective_amount"] == 125
    assert rows[1]["effective_amount"] is None
    assert (await finance_journal.journal_with_lines(db_session, opening))[
        "effective_amount"
    ] == 125
