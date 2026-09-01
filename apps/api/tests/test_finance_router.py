"""財務總帳路由：報帳明細、科目管理與權限。"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import select

from api.core.clock import local_today
from api.models.finance import (
    ChartAccount,
    ExpenseClaimItem,
    ExpensePaymentStatus,
    ExpenseProcurementStatus,
    FiscalPeriod,
    FundAccount,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.services.finance import initialize_ledger


async def _grant(db_session, user, code: str) -> Org:
    org = Org(name=f"finance-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="財務人員")
    db_session.add(position)
    await db_session.flush()
    db_session.add(Permission(position_id=position.id, code=code))
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()
    return org


async def _grant_many(db_session, users, codes: list[str]) -> Org:
    org = Org(name=f"finance-workflow-org-{uuid.uuid4().hex[:6]}")
    db_session.add(org)
    await db_session.flush()
    position = Position(org_id=org.id, name="財務工作小組")
    db_session.add(position)
    await db_session.flush()
    db_session.add_all([Permission(position_id=position.id, code=code) for code in codes])
    db_session.add_all(
        [
            UserPosition(
                user_id=user.id,
                position_id=position.id,
                start_date=local_today() - timedelta(days=1),
                end_date=None,
            )
            for user in users
        ]
    )
    await db_session.flush()
    return org


async def _make_ledger(db_session, org: Org | None = None):
    if org is None:
        org = Org(name=f"ledger-org-{uuid.uuid4().hex[:6]}")
        db_session.add(org)
        await db_session.flush()
    ledger = await initialize_ledger(db_session, org.id, "測試帳本")
    period = FiscalPeriod(
        ledger_id=ledger.id,
        name="115 學年度上學期",
        starts_on=date(2026, 7, 1),
        ends_on=date(2026, 12, 31),
    )
    db_session.add(period)
    await db_session.flush()
    fund = await db_session.scalar(
        select(ChartAccount).where(
            ChartAccount.ledger_id == ledger.id,
            ChartAccount.code == "1101",
        )
    )
    expense = await db_session.scalar(
        select(ChartAccount).where(
            ChartAccount.ledger_id == ledger.id,
            ChartAccount.code == "5101",
        )
    )
    return ledger, period, fund, expense


async def test_expense_claim_with_multiple_items_creates_pending_journal(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant(db_session, member_user, "finance:expense_claim")
    ledger, period, fund, expense = await _make_ledger(db_session, org)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    ac = authed_client_factory(member_user)

    response = await ac.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "文具採購",
            "items": [
                {
                    "name": "原子筆",
                    "unit_price": 200,
                    "tax_rate": 5,
                    "quantity": 1,
                    "budget_exception_note": "尚未編列",
                },
                {
                    "name": "立可帶",
                    "unit_price": 35,
                    "quantity": 2,
                    "budget_exception_note": "尚未編列",
                },
                {
                    "name": "膠帶",
                    "unit_price": 20,
                    "quantity": 1,
                    "budget_exception_note": "尚未編列",
                },
            ],
        },
    )

    assert response.status_code == 201
    assert response.json()["status"] == "pending_review"
    assert response.json()["lines"][0]["debit"] == 300
    items = list(
        (
            await db_session.execute(
                select(ExpenseClaimItem).where(
                    ExpenseClaimItem.journal_entry_id == uuid.UUID(response.json()["id"])
                )
            )
        ).scalars()
    )
    assert [
        (item.name, item.unit_price, item.tax_rate, item.quantity, item.unit) for item in items
    ] == [
        ("原子筆", 200, 5, 1, "項"),
        ("立可帶", 35, 0, 2, "項"),
        ("膠帶", 20, 0, 1, "項"),
    ]


async def test_expense_claim_creator_can_review_and_return_own_submission(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant_many(db_session, [member_user], ["finance:expense_claim", "finance:review"])
    ledger, period, fund, expense = await _make_ledger(db_session, org)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    ac = authed_client_factory(member_user)

    async def create_claim(description: str) -> str:
        response = await ac.post(
            f"/finance/ledgers/{ledger.id}/expense-claims",
            json={
                "period_id": str(period.id),
                "entry_date": "2026-07-18",
                "fund_account_id": str(fund_account_id),
                "expense_account_id": str(expense.id),
                "description": description,
                "items": [
                    {
                        "name": "文具",
                        "unit_price": 100,
                        "quantity": 1,
                        "budget_exception_note": "尚未編列預算",
                    }
                ],
            },
        )
        assert response.status_code == 201
        return response.json()["id"]

    own_review = await create_claim("自己覆核的報帳")
    reviewed = await ac.post(f"/finance/journals/{own_review}/post")
    assert reviewed.status_code == 200
    assert reviewed.json()["claim_status"] == "approved"

    own_return = await create_claim("自己退回的報帳")
    returned = await ac.post(
        f"/finance/journals/{own_return}/return", json={"note": "請補上憑證說明"}
    )
    assert returned.status_code == 200
    assert returned.json()["claim_status"] == "returned"


async def test_create_expense_claim_without_permission_returns_403(
    db_session, member_user, authed_client_factory
) -> None:
    ledger, period, fund, expense = await _make_ledger(db_session)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    ac = authed_client_factory(member_user)

    response = await ac.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "沒有權限的報帳",
            "items": [{"name": "原子筆", "unit_price": 12, "quantity": 1}],
        },
    )

    assert response.status_code == 403


async def test_update_expense_account_name_with_manage_permission(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant(db_session, member_user, "finance:manage")
    ledger, _, _, expense = await _make_ledger(db_session, org)
    ac = authed_client_factory(member_user)

    response = await ac.patch(
        f"/finance/ledgers/{ledger.id}/accounts/{expense.id}",
        json={"name": "活動文具支出"},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "活動文具支出"


async def test_import_budget_xlsx_creates_categories_and_allocations(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant_many(db_session, [member_user], ["finance:budget", "finance:view"])
    ledger, period, _, _ = await _make_ledger(db_session, org)
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["項目", "細項", "數量", "單價", "總額(含稅)", "備註"])
    sheet.append(["行政雜支", "文具購買", 2, 150, 300, ""])
    sheet.append([None, "臨時支出", 1, "*", 500, "核准後補憑證"])
    file_buffer = BytesIO()
    workbook.save(file_buffer)

    response = await authed_client_factory(member_user).post(
        f"/finance/ledgers/{ledger.id}/budgets/import",
        data={
            "period_id": str(period.id),
            "name": "115 學年度預算",
            "title": "預算案匯入",
        },
        files={
            "file": (
                "預算案.xlsx",
                file_buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["categories_created"] == 1
    assert response.json()["allocations_created"] == 2
    assert response.json()["skipped_rows"] == []
    detail = await authed_client_factory(member_user).get(
        f"/finance/budgets/{response.json()['budget']['id']}"
    )
    assert detail.status_code == 200
    assert sorted(allocation["amount"] for allocation in detail.json()["allocations"]) == [300, 500]


async def test_expense_workflow_tracks_review_procurement_payment_and_budget(
    db_session, member_user, make_user, authed_client_factory
) -> None:
    reviewer = await make_user(email="finance-reviewer@school.edu")
    org = await _grant_many(
        db_session,
        [member_user, reviewer],
        [
            "finance:expense_claim",
            "finance:view",
            "finance:review",
            "finance:procurement",
            "finance:school_payment",
            "finance:budget",
            "finance:budget_review",
        ],
    )
    ledger, period, fund, expense = await _make_ledger(db_session, org)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    creator_client = authed_client_factory(member_user)
    reviewer_client = authed_client_factory(reviewer)

    budget = await creator_client.post(
        f"/finance/ledgers/{ledger.id}/budgets",
        json={"period_id": str(period.id), "name": "文具預算"},
    )
    submission = await creator_client.post(
        f"/finance/budgets/{budget.json()['id']}/submissions",
        json={"kind": "initial", "title": "文具初始預算案"},
    )
    node = await creator_client.post(
        f"/finance/budget-submissions/{submission.json()['id']}/nodes",
        json={"name": "文具購買"},
    )
    allocation = await creator_client.post(
        f"/finance/budget-submissions/{submission.json()['id']}/allocations",
        json={
            "node_id": node.json()["id"],
            "quantity": 2.5,
            "unit": "盒",
            "unit_price": 120,
            "proposing_org_id": str(org.id),
        },
    )
    assert allocation.status_code == 201
    assert allocation.json()["amount"] == 300
    assert allocation.json()["unit"] == "盒"
    assert allocation.json()["quantity"] == 2.5
    assert (
        await creator_client.post(f"/finance/budget-submissions/{submission.json()['id']}/submit")
    ).status_code == 200
    assert (
        await reviewer_client.post(
            f"/finance/budget-submissions/{submission.json()['id']}/review",
            json={"status": "approved"},
        )
    ).status_code == 200

    created = await creator_client.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "校商文具採購",
            "source_url": "https://vendor.example/quote/123",
            "items": [
                {
                    "name": "原子筆",
                    "unit_price": 120,
                    "quantity": 2,
                    "unit": "支",
                    "budget_node_id": node.json()["id"],
                    "evidence": [
                        {
                            "storage_key": f"finance/evidence/{ledger.id}/{'a' * 32}.pdf",
                            "filename": "receipt.pdf",
                            "content_type": "application/pdf",
                            "file_size": 100,
                        }
                    ],
                }
            ],
        },
    )
    assert created.status_code == 201
    entry_id = created.json()["id"]
    assert created.json()["claim_status"] == "pending_review"
    assert created.json()["payment_status"] == "unpaid"
    assert created.json()["budget_included"] is False

    posted = await reviewer_client.post(f"/finance/journals/{entry_id}/post")
    assert posted.status_code == 200
    assert posted.json()["claim_status"] == "approved"

    procurement = await reviewer_client.patch(
        f"/finance/journals/{entry_id}/procurement",
        json={"status": ExpenseProcurementStatus.REQUESTED},
    )
    assert procurement.status_code == 400

    budget = await reviewer_client.patch(
        f"/finance/journals/{entry_id}/budget", json={"included": True}
    )
    assert budget.status_code == 200
    assert budget.json()["budget_included"] is True

    updated = await creator_client.patch(
        f"/finance/journals/{entry_id}/expense-claim",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "校商文具採購（修正）",
            "items": [
                {
                    "name": "原子筆",
                    "unit_price": 100,
                    "quantity": 1,
                    "unit": "支",
                    "budget_node_id": node.json()["id"],
                    "evidence": [
                        {
                            "storage_key": f"finance/evidence/{ledger.id}/{'a' * 32}.pdf",
                            "filename": "receipt.pdf",
                            "content_type": "application/pdf",
                            "file_size": 100,
                        }
                    ],
                }
            ],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "posted"
    assert updated.json()["claim_status"] == "approved"
    assert updated.json()["budget_included"] is True
    assert updated.json()["lines"][0]["debit"] == 100

    procurement = await reviewer_client.patch(
        f"/finance/journals/{entry_id}/procurement",
        json={"status": ExpenseProcurementStatus.REQUESTED},
    )
    assert procurement.status_code == 200
    assert procurement.json()["procurement_status"] == "requested"

    paid = await reviewer_client.post(f"/finance/journals/{entry_id}/school-payment")
    assert paid.status_code == 200
    assert paid.json()["payment_status"] == ExpensePaymentStatus.SCHOOL_PAID

    completed = await reviewer_client.post(f"/finance/journals/{entry_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["claim_status"] == "completed"
    settlement = await reviewer_client.get(
        f"/finance/ledgers/{ledger.id}/periods/{period.id}/settlement"
    )
    assert settlement.status_code == 200
    assert settlement.json()["budgeted_total"] == 300
    assert settlement.json()["settled_total"] == 100
    assert settlement.json()["unsettled_claim_count"] == 0

    duplicate_payment = await reviewer_client.post(f"/finance/journals/{entry_id}/school-payment")
    assert duplicate_payment.status_code == 400


async def test_expense_workflow_action_requires_special_permission(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant(db_session, member_user, "finance:expense_claim")
    ledger, period, fund, expense = await _make_ledger(db_session, org)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    ac = authed_client_factory(member_user)
    created = await ac.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "未授權狀態操作",
            "items": [
                {
                    "name": "資料夾",
                    "unit_price": 80,
                    "quantity": 1,
                    "budget_exception_note": "尚未編列",
                }
            ],
        },
    )

    response = await ac.patch(
        f"/finance/journals/{created.json()['id']}/procurement",
        json={"status": ExpenseProcurementStatus.REQUESTED},
    )
    assert response.status_code == 403


async def test_shared_budget_submission_tracks_hierarchy_and_internal_review(
    db_session, member_user, make_user, authed_client_factory
) -> None:
    reviewer = await make_user(email="budget-reviewer@school.edu")
    org = await _grant_many(
        db_session,
        [member_user, reviewer],
        ["finance:view", "finance:budget", "finance:budget_propose", "finance:budget_review"],
    )
    ledger, period, _, _ = await _make_ledger(db_session, org)
    creator = authed_client_factory(member_user)
    reviewer_client = authed_client_factory(reviewer)

    budget = await creator.post(
        f"/finance/ledgers/{ledger.id}/budgets",
        json={"period_id": str(period.id), "name": "115 學年度共同預算"},
    )
    assert budget.status_code == 201
    submission = await creator.post(
        f"/finance/budgets/{budget.json()['id']}/submissions",
        json={"kind": "initial", "title": "初始預算案"},
    )
    assert submission.status_code == 201
    category = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/nodes",
        json={"name": "行政庶務"},
    )
    leaf = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/nodes",
        json={"parent_id": category.json()["id"], "name": "文具購買"},
    )
    allocation = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/allocations",
        json={
            "node_id": leaf.json()["id"],
            "quantity": 25,
            "unit": "件",
            "unit_price": 200,
            "proposing_org_id": str(org.id),
        },
    )
    assert allocation.status_code == 201
    submitted = await creator.post(f"/finance/budget-submissions/{submission.json()['id']}/submit")
    assert submitted.json()["status"] == "submitted"
    approved = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/review",
        json={"status": "approved"},
    )
    assert approved.json()["status"] == "approved"
    detail = await creator.get(f"/finance/budgets/{budget.json()['id']}")
    assert detail.status_code == 200
    leaf_detail = next(item for item in detail.json()["nodes"] if item["id"] == leaf.json()["id"])
    assert leaf_detail["allocated_amount"] == 5000
    published = await reviewer_client.patch(
        f"/finance/budgets/{budget.json()['id']}/publication",
        json={"is_public": True},
    )
    assert published.status_code == 200
    assert published.json()["is_public"] is True
    public_list = await creator.get("/finance/public/budgets")
    assert public_list.status_code == 200
    assert public_list.json()[0]["id"] == budget.json()["id"]
    public_detail = await creator.get(f"/finance/public/budgets/{budget.json()['id']}")
    assert public_detail.status_code == 200
    assert public_detail.json()["allocations"][0]["unit"] == "件"
    assert "proposed_by_id" not in public_detail.json()["allocations"][0]
