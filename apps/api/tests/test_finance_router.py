"""財務總帳路由：報帳明細、科目管理與權限。"""

from __future__ import annotations

import uuid
from datetime import date, timedelta

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
                {"name": "原子筆", "unit_price": 200, "tax_rate": 5, "quantity": 1},
                {"name": "立可帶", "unit_price": 35, "quantity": 2},
                {"name": "膠帶", "unit_price": 20, "quantity": 1},
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
    assert [(item.name, item.unit_price, item.tax_rate, item.quantity) for item in items] == [
        ("原子筆", 200, 5, 1),
        ("立可帶", 35, 0, 2),
        ("膠帶", 20, 0, 1),
    ]


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


async def test_expense_workflow_tracks_review_procurement_payment_and_budget(
    db_session, member_user, make_user, authed_client_factory
) -> None:
    reviewer = await make_user(email="finance-reviewer@school.edu")
    org = await _grant_many(
        db_session,
        [member_user, reviewer],
        [
            "finance:expense_claim",
            "finance:review",
            "finance:procurement",
            "finance:school_payment",
            "finance:budget",
        ],
    )
    ledger, period, fund, expense = await _make_ledger(db_session, org)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    creator_client = authed_client_factory(member_user)
    reviewer_client = authed_client_factory(reviewer)

    created = await creator_client.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "校商文具採購",
            "source_url": "https://vendor.example/quote/123",
            "items": [{"name": "原子筆", "unit_price": 120, "quantity": 2}],
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
    assert procurement.status_code == 200
    assert procurement.json()["procurement_status"] == "requested"

    budget = await reviewer_client.patch(
        f"/finance/journals/{entry_id}/budget", json={"included": True}
    )
    assert budget.status_code == 200
    assert budget.json()["budget_included"] is True

    paid = await reviewer_client.post(f"/finance/journals/{entry_id}/school-payment")
    assert paid.status_code == 200
    assert paid.json()["payment_status"] == ExpensePaymentStatus.SCHOOL_PAID

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
            "items": [{"name": "資料夾", "unit_price": 80, "quantity": 1}],
        },
    )

    response = await ac.patch(
        f"/finance/journals/{created.json()['id']}/procurement",
        json={"status": ExpenseProcurementStatus.REQUESTED},
    )
    assert response.status_code == 403
