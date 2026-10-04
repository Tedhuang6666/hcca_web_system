"""財務總帳路由：報帳明細、科目管理與權限。"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import PatternFill
from sqlalchemy import select

from api.core.clock import local_today
from api.models.finance import (
    ChartAccount,
    ExpenseClaimItem,
    ExpensePaymentStatus,
    ExpenseProcurementStatus,
    FinanceLedger,
    FiscalPeriod,
    FundAccount,
)
from api.models.org import Org, Permission, Position, UserPosition
from api.services.finance import _parse_budget_workbook, initialize_ledger


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


async def _grant_on_org(db_session, user, org: Org, codes: list[str]) -> None:
    position = Position(org_id=org.id, name=f"財務角色-{uuid.uuid4().hex[:6]}")
    db_session.add(position)
    await db_session.flush()
    db_session.add_all([Permission(position_id=position.id, code=code) for code in codes])
    db_session.add(
        UserPosition(
            user_id=user.id,
            position_id=position.id,
            start_date=local_today() - timedelta(days=1),
            end_date=None,
        )
    )
    await db_session.flush()


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


async def test_list_ledgers_only_returns_ledgers_the_user_can_view(
    db_session, member_user, client, authed_client_factory
) -> None:
    org = await _grant(db_session, member_user, "finance:view")
    visible_ledger, _, _, _ = await _make_ledger(db_session, org)
    hidden_ledger, _, _, _ = await _make_ledger(db_session)

    assert (await client.get("/finance/ledgers")).status_code == 401
    response = await authed_client_factory(member_user).get("/finance/ledgers")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(visible_ledger.id)]
    assert str(hidden_ledger.id) not in {item["id"] for item in response.json()}


def test_budget_import_classifies_income_by_amount_cell_not_category_or_row() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["項目", "細項", "數量", "單價", "總額(含稅)", "項目總額", "備註"])
    sheet.append(["新生報到", "校商收入", "1式", "*", 21630, 20730, ""])
    sheet["E2"].fill = PatternFill(fill_type="solid", fgColor="D9EAD3")
    sheet.append([None, "午餐費", "9人", 100, 900, None, ""])
    sheet.append(["聖誕傳情", "餅乾費用", "4000份", 30, 120000, 32000, ""])
    sheet["F4"].fill = PatternFill(fill_type="solid", fgColor="D9EAD3")
    sheet.append([None, "販售收入", "4000份", 40, 160000, None, ""])
    sheet["E5"].fill = PatternFill(fill_type="solid", fgColor="D9EAD3")
    sheet.append(["行政雜支", "臨時支出", "1式", "*", 500, None, ""])
    buffer = BytesIO()
    workbook.save(buffer)

    expenses, income, skipped = _parse_budget_workbook(buffer.getvalue())

    assert [row["detail"] for row in expenses] == ["午餐費", "餅乾費用", "臨時支出"]
    assert [row["name"] for row in income] == ["校商收入", "販售收入"]
    total_only = expenses[-1]
    assert total_only["amount"] == 500
    assert total_only["unit_price"] is None
    assert total_only["note"] is None
    assert skipped == []


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


async def test_opening_balance_can_be_corrected_without_exposing_uuid(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant_many(
        db_session, [member_user], ["finance:record", "finance:review", "finance:view"]
    )
    ledger, period, fund, _ = await _make_ledger(db_session, org)
    equity = await db_session.scalar(
        select(ChartAccount).where(
            ChartAccount.ledger_id == ledger.id,
            ChartAccount.account_type == "equity",
        )
    )
    fund_account = await db_session.scalar(
        select(FundAccount).where(FundAccount.chart_account_id == fund.id)
    )
    ac = authed_client_factory(member_user)
    created = await ac.post(
        f"/finance/ledgers/{ledger.id}/journals",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-01",
            "description": "期初餘額｜銀行存款",
            "source_type": "manual_entry",
            "source_event": "opening",
            "lines": [
                {"account_id": str(fund.id), "debit": 500},
                {"account_id": str(equity.id), "credit": 500},
            ],
        },
    )
    assert created.status_code == 201
    assert created.json()["reference_no"].startswith("FIN-260701-")
    assert created.json()["created_by_name"] == member_user.display_name

    entry_id = created.json()["id"]
    await ac.post(f"/finance/journals/{entry_id}/submit")
    corrected = await ac.patch(
        f"/finance/journals/{entry_id}/manual-entry",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-01",
            "fund_account_id": str(fund_account.id),
            "counterpart_account_id": str(equity.id),
            "description": "期初餘額｜銀行存款",
            "amount": 650,
        },
    )
    assert corrected.status_code == 200
    assert corrected.json()["id"] == entry_id
    assert corrected.json()["effective_amount"] == 650
    assert sum(line["debit"] for line in corrected.json()["lines"]) == 650

    posted = await ac.post(f"/finance/journals/{entry_id}/post")
    assert posted.status_code == 200
    adjustment = await ac.patch(
        f"/finance/journals/{entry_id}/manual-entry",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-02",
            "fund_account_id": str(fund_account.id),
            "counterpart_account_id": str(equity.id),
            "description": "銀行存款",
            "amount": 700,
        },
    )
    assert adjustment.status_code == 200
    assert adjustment.json()["id"] != entry_id
    assert adjustment.json()["source_event"].startswith("opening_adjustment:")
    assert adjustment.json()["status"] == "pending_review"
    assert sum(line["debit"] for line in adjustment.json()["lines"]) == 50

    posted_adjustment = await ac.post(f"/finance/journals/{adjustment.json()['id']}/post")
    assert posted_adjustment.status_code == 200
    second_adjustment = await ac.patch(
        f"/finance/journals/{entry_id}/manual-entry",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-03",
            "fund_account_id": str(fund_account.id),
            "counterpart_account_id": str(equity.id),
            "description": "銀行存款",
            "amount": 675,
        },
    )
    assert second_adjustment.status_code == 200
    assert second_adjustment.json()["id"] != adjustment.json()["id"]
    assert sum(line["credit"] for line in second_adjustment.json()["lines"]) == 25


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
    sheet.append(["收入", None, None, None, None, None])
    sheet["A4"].fill = PatternFill(fill_type="solid", fgColor="FF92D050")
    sheet.append([None, "活動報名費", 1, 300, 300, "春季活動"])
    sheet["E5"].fill = PatternFill(fill_type="solid", fgColor="D9EAD3")
    sheet.append([None, "活動餐點", 1, 250, 250, "同一分類中的支出"])
    sheet.append(["行政雜支", "影印紙", 2, 100, 200, ""])
    file_buffer = BytesIO()
    workbook.save(file_buffer)

    response = await authed_client_factory(member_user).post(
        f"/finance/ledgers/{ledger.id}/budgets/import",
        data={
            "period_id": str(period.id),
            "name": "115 學年度預算",
            "title": "預算案匯入",
            "council_approved_on": "2026-08-19",
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
    assert response.json()["budget"]["is_public"] is True
    assert response.json()["submission"]["status"] == "approved"
    assert response.json()["categories_created"] == 2
    assert response.json()["allocations_created"] == 4
    assert response.json()["income_items_created"] == 1
    assert response.json()["skipped_rows"] == []
    detail = await authed_client_factory(member_user).get(
        f"/finance/budgets/{response.json()['budget']['id']}"
    )
    assert detail.status_code == 200
    assert sorted(allocation["amount"] for allocation in detail.json()["allocations"]) == [
        200,
        250,
        300,
        500,
    ]
    imported_without_unit_price = next(
        node for node in detail.json()["nodes"] if node["name"] == "臨時支出"
    )
    imported_total_allocation = next(
        item
        for item in detail.json()["allocations"]
        if item["node_id"] == imported_without_unit_price["id"]
    )
    assert imported_total_allocation["amount"] == 500
    assert imported_total_allocation["note"] == "核准後補憑證"
    assert "原始單價未提供" not in imported_total_allocation["note"]
    assert [item["name"] for item in detail.json()["income_items"]] == ["活動報名費"]
    assert detail.json()["income_items"][0]["category"] == "收入"

    replacement = Workbook()
    replacement_sheet = replacement.active
    replacement_sheet.append(["項目", "細項", "數量", "單價", "總額(含稅)", "備註"])
    replacement_sheet.append(["行政雜支", "文具購買", 4, 180, 720, "改用新版估價"])
    replacement_buffer = BytesIO()
    replacement.save(replacement_buffer)
    reimported = await authed_client_factory(member_user).post(
        f"/finance/ledgers/{ledger.id}/budgets/import",
        data={
            "period_id": str(period.id),
            "name": "115 學年度預算",
            "budget_id": response.json()["budget"]["id"],
            "council_approved_on": "2026-08-20",
        },
        files={
            "file": (
                "預算案修正版.xlsx",
                replacement_buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert reimported.status_code == 201
    assert reimported.json()["budget"]["id"] == response.json()["budget"]["id"]
    assert reimported.json()["submission"]["id"] != response.json()["submission"]["id"]
    detail_after_reimport = await authed_client_factory(member_user).get(
        f"/finance/budgets/{response.json()['budget']['id']}"
    )
    assert sorted(
        allocation["amount"] for allocation in detail_after_reimport.json()["allocations"]
    ) == [200, 250, 300, 500, 720]
    assert [item["name"] for item in detail_after_reimport.json()["income_items"]] == ["活動報名費"]
    assert "臨時支出" in {node["name"] for node in detail_after_reimport.json()["nodes"]}


async def test_budget_import_is_approved_without_review_permission(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant_many(db_session, [member_user], ["finance:budget", "finance:view"])
    ledger, period, _, _ = await _make_ledger(db_session, org)
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["項目", "細項", "數量", "單價", "總額(含稅)", "備註"])
    sheet.append(["行政雜支", "文具", 1, 200, 200, ""])
    file_buffer = BytesIO()
    workbook.save(file_buffer)
    upload = {
        "file": (
            "預算案.xlsx",
            file_buffer.getvalue(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    endpoint = f"/finance/ledgers/{ledger.id}/budgets/import"
    form = {
        "period_id": str(period.id),
        "name": "115 學年度預算",
        "council_approved_on": "2026-08-19",
    }

    missing_date = await authed_client_factory(member_user).post(
        endpoint, data={"period_id": str(period.id), "name": "115 學年度預算"}, files=upload
    )
    assert missing_date.status_code == 422

    approved = await authed_client_factory(member_user).post(endpoint, data=form, files=upload)
    assert approved.status_code == 201
    assert approved.json()["submission"]["status"] == "approved"
    assert approved.json()["submission"]["council_approved_on"] == "2026-08-19"


async def test_budget_expense_without_items_is_visible_on_public_budget(
    db_session, member_user, make_user, client, authed_client_factory
) -> None:
    org = await _grant_many(db_session, [member_user], ["finance:budget", "finance:view"])
    viewer = await make_user(email="budget-expense-viewer@school.edu")
    await _grant_on_org(db_session, viewer, org, ["finance:view"])
    ledger, period, _, _ = await _make_ledger(db_session, org)
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["項目", "細項", "數量", "單價", "總額(含稅)", "備註"])
    sheet.append(["行政雜支", "文具費", "1式", "*", 2000, ""])
    file_buffer = BytesIO()
    workbook.save(file_buffer)
    client = authed_client_factory(member_user)

    imported = await client.post(
        f"/finance/ledgers/{ledger.id}/budgets/import",
        data={
            "period_id": str(period.id),
            "name": "測試預算",
            "council_approved_on": "2026-08-19",
        },
        files={
            "file": (
                "預算案.xlsx",
                file_buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert imported.status_code == 201
    budget_id = imported.json()["budget"]["id"]
    budget = await client.get(f"/finance/budgets/{budget_id}")
    allocation_id = budget.json()["allocations"][0]["id"]

    expense = await client.post(
        f"/finance/budgets/{budget_id}/expenses",
        json={
            "allocation_id": allocation_id,
            "entry_date": "2026-08-20",
            "purpose": "文具補貨",
            "total_amount": 950,
            "items": [],
        },
    )
    assert expense.status_code == 201
    assert expense.json()["total_amount"] == 950
    assert expense.json()["items"] == []
    assert expense.json()["department_org_id"] == str(org.id)
    assert expense.json()["department_name"] == org.name

    other_department = Org(name="活動部")
    db_session.add(other_department)
    await db_session.flush()
    update_path = f"/finance/budgets/{budget_id}/expenses/{expense.json()['id']}"
    update_body = {
        "allocation_id": allocation_id,
        "department_org_id": str(other_department.id),
        "entry_date": "2026-08-21",
        "purpose": "文具與紙張補貨",
        "note": "已補上第二張收據",
        "items": [
            {
                "name": "影印紙",
                "unit_price": 1500,
                "tax_rate": 5,
                "quantity": 2,
                "unit": "箱",
            }
        ],
    }
    assert (await client.patch(update_path, json=update_body)).status_code == 401
    assert (
        await authed_client_factory(viewer).patch(update_path, json=update_body)
    ).status_code == 403

    updated = await authed_client_factory(member_user).patch(update_path, json=update_body)
    assert updated.status_code == 200
    assert updated.json()["entry_date"] == "2026-08-21"
    assert updated.json()["purpose"] == "文具與紙張補貨"
    assert updated.json()["total_amount"] == 3150
    assert updated.json()["note"] == "已補上第二張收據"
    assert updated.json()["department_org_id"] == str(other_department.id)
    assert updated.json()["department_name"] == other_department.name
    assert updated.json()["items"][0]["name"] == "影印紙"

    public = await client.get(f"/finance/public/budgets/{budget_id}")
    assert public.status_code == 200
    assert public.json()["expenses"][0]["purpose"] == "文具與紙張補貨"
    assert public.json()["expenses"][0]["total_amount"] == 3150
    assert public.json()["expenses"][0]["items"][0]["name"] == "影印紙"


async def test_finance_test_reset_is_superuser_only_and_clears_finance_data(
    db_session, member_user, authed_client_factory
) -> None:
    ledger, _, _, _ = await _make_ledger(db_session)
    client = authed_client_factory(member_user)

    forbidden = await client.delete("/finance/test-reset")
    assert forbidden.status_code == 403
    assert (
        await db_session.scalar(select(FinanceLedger.id).where(FinanceLedger.id == ledger.id))
        == ledger.id
    )

    member_user.is_superuser = True
    await db_session.flush()
    cleared = await client.delete("/finance/test-reset")

    assert cleared.status_code == 200
    assert cleared.json()["records_deleted"] > 0
    assert cleared.json()["evidence_files_failed"] == 0
    assert (
        await db_session.scalar(select(FinanceLedger.id).where(FinanceLedger.id == ledger.id))
        is None
    )


async def test_council_review_draft_has_a_public_page_without_internal_data(
    db_session, member_user, authed_client_factory
) -> None:
    org = await _grant_many(db_session, [member_user], ["finance:budget", "finance:view"])
    ledger, period, _, _ = await _make_ledger(db_session, org)
    client = authed_client_factory(member_user)
    budget = await client.post(
        f"/finance/ledgers/{ledger.id}/budgets",
        json={"period_id": str(period.id), "name": "議員審理預算"},
    )
    submission = await client.post(
        f"/finance/budgets/{budget.json()['id']}/submissions",
        json={"kind": "initial", "title": "115 學年度送審草案"},
    )
    node = await client.post(
        f"/finance/budget-submissions/{submission.json()['id']}/nodes",
        json={"name": "活動支出"},
    )
    allocation = await client.post(
        f"/finance/budget-submissions/{submission.json()['id']}/allocations",
        json={
            "node_id": node.json()["id"],
            "amount": 3600,
            "proposing_org_id": str(org.id),
            "note": "供議員審理的活動預算",
        },
    )
    assert allocation.status_code == 201

    published = await client.patch(
        f"/finance/budget-submissions/{submission.json()['id']}/council-review-publication",
        json={"is_public": True},
    )
    assert published.status_code == 200
    assert published.json()["is_council_review_public"] is True
    assert (await client.get(f"/finance/public/budgets/{budget.json()['id']}")).status_code == 404

    public_list = await client.get("/finance/public/budgets")
    public_item = next(
        item
        for item in public_list.json()
        if item["id"] == budget.json()["id"] and item["visibility"] == "council_review"
    )
    assert public_item["review_submission_id"] == submission.json()["id"]
    public_detail = await client.get(
        f"/finance/public/budgets/{budget.json()['id']}",
        params={"review_submission_id": submission.json()["id"]},
    )
    assert public_detail.status_code == 200
    assert public_detail.json()["visibility"] == "council_review"
    assert public_detail.json()["review_submission"]["status"] == "draft"
    assert public_detail.json()["allocations"][0]["amount"] == 3600
    assert "proposed_by_id" not in public_detail.json()["allocations"][0]
    assert "evidence" not in public_detail.json()["allocations"][0]


async def test_public_finance_totals_and_expenses_only_show_published_budget_data(
    db_session, member_user, make_user, client, authed_client_factory
) -> None:
    reviewer = await make_user(email="finance-public-reviewer@school.edu")
    org = await _grant_many(
        db_session,
        [member_user, reviewer],
        [
            "finance:record",
            "finance:view",
            "finance:expense_claim",
            "finance:review",
            "finance:school_payment",
            "finance:budget",
            "finance:budget_review",
        ],
    )
    ledger, period, fund, expense = await _make_ledger(db_session, org)
    fund_account_id = await db_session.scalar(
        select(FundAccount.id).where(FundAccount.chart_account_id == fund.id)
    )
    revenue = await db_session.scalar(
        select(ChartAccount).where(
            ChartAccount.ledger_id == ledger.id,
            ChartAccount.code == "4101",
        )
    )
    assert fund_account_id and revenue
    creator = authed_client_factory(member_user)
    reviewer_client = authed_client_factory(reviewer)

    budget = await creator.post(
        f"/finance/ledgers/{ledger.id}/budgets",
        json={"period_id": str(period.id), "name": "公開活動預算"},
    )
    submission = await creator.post(
        f"/finance/budgets/{budget.json()['id']}/submissions",
        json={"kind": "initial", "title": "活動初始預算案"},
    )
    node = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/nodes",
        json={"name": "活動印刷"},
    )
    allocation = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/allocations",
        json={
            "node_id": node.json()["id"],
            "amount": 1000,
            "proposing_org_id": str(org.id),
        },
    )
    assert allocation.status_code == 201
    assert (
        await creator.post(f"/finance/budget-submissions/{submission.json()['id']}/submit")
    ).status_code == 200
    assert (
        await reviewer_client.post(
            f"/finance/budget-submissions/{submission.json()['id']}/review",
            json={"status": "approved", "council_approved_on": "2026-08-19"},
        )
    ).status_code == 200

    viewer = await make_user(email="finance-expense-viewer@school.edu")
    await _grant_on_org(db_session, viewer, org, ["finance:view"])
    viewer_client = authed_client_factory(viewer)
    receipt = await creator.post(
        f"/finance/ledgers/{ledger.id}/evidence",
        files={"file": ("文具收據.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")},
    )
    assert receipt.status_code == 201
    direct_expense_body = {
        "allocation_id": allocation.json()["id"],
        "entry_date": "2026-07-18",
        "purpose": "文具採購",
        "items": [
            {"name": "原子筆", "unit_price": 20, "quantity": 3, "unit": "支"},
            {"name": "筆記本", "unit_price": 10, "quantity": 2, "unit": "本"},
        ],
        "evidence": [receipt.json()],
    }
    direct_expense = await creator.post(
        f"/finance/budgets/{budget.json()['id']}/expenses", json=direct_expense_body
    )
    assert direct_expense.status_code == 201
    assert direct_expense.json()["total_amount"] == 80
    assert len(direct_expense.json()["items"]) == 2
    assert len(direct_expense.json()["evidence"]) == 1
    public_receipt_before_publish = await client.get(
        f"/finance/public/budgets/{budget.json()['id']}/expenses/"
        f"{direct_expense.json()['id']}/evidence/{direct_expense.json()['evidence'][0]['id']}"
    )
    assert public_receipt_before_publish.status_code == 404
    forbidden_expense = await viewer_client.post(
        f"/finance/budgets/{budget.json()['id']}/expenses", json=direct_expense_body
    )
    assert forbidden_expense.status_code == 403
    budget_detail = await creator.get(f"/finance/budgets/{budget.json()['id']}")
    assert budget_detail.status_code == 200
    assert budget_detail.json()["expenses"][0]["items"][0]["name"] == "原子筆"
    assert (
        next(item for item in budget_detail.json()["nodes"] if item["id"] == node.json()["id"])[
            "used_amount"
        ]
        == 80
    )

    income = await creator.post(
        f"/finance/ledgers/{ledger.id}/journals",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-18",
            "description": "活動報名收入",
            "lines": [
                {"account_id": str(fund.id), "debit": 500},
                {"account_id": str(revenue.id), "credit": 500},
            ],
        },
    )
    assert income.status_code == 201
    submitted_income = await creator.post(f"/finance/journals/{income.json()['id']}/submit")
    assert submitted_income.status_code == 200
    assert (
        await reviewer_client.post(f"/finance/journals/{income.json()['id']}/post")
    ).status_code == 200

    claim = await creator.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-19",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "活動海報印刷",
            "proposing_org_id": str(org.id),
            "source_url": "https://private.example/source",
            "note": "內部備註不公開",
            "items": [
                {
                    "name": "海報印刷",
                    "unit_price": 120,
                    "quantity": 2,
                    "budget_node_id": node.json()["id"],
                    "evidence": [receipt.json()],
                },
                {
                    "name": "膠帶",
                    "unit_price": 50,
                    "quantity": 1,
                    "budget_node_id": node.json()["id"],
                },
            ],
        },
    )
    assert claim.status_code == 201
    entry_id = claim.json()["id"]
    unpublished_claim_detail = await client.get(
        f"/finance/public/budgets/{budget.json()['id']}/expense-claims/{entry_id}"
    )
    assert unpublished_claim_detail.status_code == 404
    assert (await reviewer_client.post(f"/finance/journals/{entry_id}/post")).status_code == 200
    assert (
        await reviewer_client.patch(f"/finance/journals/{entry_id}/budget", json={"included": True})
    ).status_code == 200
    assert (
        await reviewer_client.post(f"/finance/journals/{entry_id}/school-payment")
    ).status_code == 200
    assert (await reviewer_client.post(f"/finance/journals/{entry_id}/complete")).status_code == 200

    pending_claim = await creator.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-21",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "活動文具支出",
            "items": [
                {
                    "name": "活動文具",
                    "unit_price": 100,
                    "quantity": 1,
                    "budget_node_id": node.json()["id"],
                }
            ],
        },
    )
    assert pending_claim.status_code == 201
    assert (
        await reviewer_client.post(f"/finance/journals/{pending_claim.json()['id']}/post")
    ).status_code == 200

    advance_claim = await creator.post(
        f"/finance/ledgers/{ledger.id}/expense-claims",
        json={
            "period_id": str(period.id),
            "entry_date": "2026-07-20",
            "fund_account_id": str(fund_account_id),
            "expense_account_id": str(expense.id),
            "description": "活動茶點代墊",
            "payment_method": "advance",
            "advanced_by_id": str(member_user.id),
            "items": [
                {
                    "name": "活動茶點",
                    "unit_price": 60,
                    "quantity": 1,
                    "budget_node_id": node.json()["id"],
                }
            ],
        },
    )
    assert advance_claim.status_code == 201
    assert (
        await reviewer_client.post(f"/finance/journals/{advance_claim.json()['id']}/post")
    ).status_code == 200

    totals_path = f"/finance/public/budgets/{budget.json()['id']}/totals"
    assert (await client.get(totals_path)).status_code == 404
    assert (await client.get("/finance/public/expenses")).json() == []

    published = await reviewer_client.patch(
        f"/finance/budgets/{budget.json()['id']}/publication",
        json={"is_public": True},
    )
    assert published.status_code == 200

    totals = await client.get(totals_path)
    assert totals.status_code == 200
    assert totals.json() == {"income_total": 500, "expense_total": 530}
    records = await client.get("/finance/public/expenses")
    assert records.status_code == 200
    record = next(item for item in records.json() if item["purpose"] == "活動海報印刷")
    assert record["claim_id"] == entry_id
    assert record == {
        "id": record["id"],
        "claim_id": entry_id,
        "budget_id": budget.json()["id"],
        "entry_date": "2026-07-19",
        "purpose": "活動海報印刷",
        "item_name": "海報印刷",
        "amount": 240,
        "quantity": 2.0,
        "unit": "項",
        "unit_price": 120,
        "budget_name": "公開活動預算",
        "budget_item": "活動印刷",
        "payment_method": "direct",
        "status": "spent",
        "evidence": [],
    }
    claim_detail = await client.get(
        f"/finance/public/budgets/{budget.json()['id']}/expense-claims/{entry_id}"
    )
    assert claim_detail.status_code == 200
    claim_detail_body = claim_detail.json()
    assert claim_detail_body["department_name"] == org.name
    assert claim_detail_body["reporter_name"] == member_user.display_name
    assert claim_detail_body["entry_date"] == "2026-07-19"
    assert claim_detail_body["reported_at"]
    assert claim_detail_body["paid_at"]
    assert claim_detail_body["total_amount"] == 290
    assert {item["name"] for item in claim_detail_body["items"]} == {"海報印刷", "膠帶"}
    claim_receipt_item = next(
        item for item in claim_detail_body["items"] if item["name"] == "海報印刷"
    )
    assert claim_receipt_item["evidence"][0]["filename"] == "文具收據.pdf"
    claim_evidence_url = claim_receipt_item["evidence"][0]["url"]
    assert (await client.get(claim_evidence_url)).status_code == 200
    assert "created_by_id" not in claim_detail_body
    assert "source_url" not in claim_detail_body
    assert "note" not in claim_detail_body
    statuses = {item["purpose"]: item["status"] for item in records.json()}
    assert statuses == {
        "活動文具支出": "pending",
        "活動茶點代墊": "awaiting_reimbursement",
        "活動海報印刷": "spent",
        "文具採購": "spent",
    }
    for item in records.json():
        assert "created_by_id" not in item
        assert "advanced_by_id" not in item
        assert "source_url" not in item
        assert "note" not in item
    direct_public_item = next(item for item in records.json() if item["purpose"] == "文具採購")
    assert direct_public_item["evidence"][0]["filename"] == "文具收據.pdf"
    assert direct_public_item["evidence"][0]["url"].startswith(
        f"/finance/public/budgets/{budget.json()['id']}/expenses/"
    )
    public_detail = await client.get(f"/finance/public/budgets/{budget.json()['id']}")
    assert public_detail.status_code == 200
    assert public_detail.json()["expenses"][0]["items"][0]["name"] == "原子筆"
    public_receipt_url = public_detail.json()["expenses"][0]["evidence"][0]["url"]
    public_receipt = await client.get(public_receipt_url)
    assert public_receipt.status_code == 200
    settlement = await reviewer_client.get(
        f"/finance/ledgers/{ledger.id}/periods/{period.id}/settlement"
    )
    assert settlement.status_code == 200
    assert settlement.json()["settled_total"] == 370


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
            json={"status": "approved", "council_approved_on": "2026-08-19"},
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
    proposer = await make_user(email="budget-proposer@school.edu")
    viewer = await make_user(email="budget-viewer@school.edu")
    org = await _grant_many(
        db_session,
        [member_user, reviewer],
        ["finance:view", "finance:budget", "finance:budget_propose", "finance:budget_review"],
    )
    ledger, period, _, _ = await _make_ledger(db_session, org)
    await _grant_on_org(db_session, proposer, org, ["finance:view", "finance:budget_propose"])
    await _grant_on_org(db_session, viewer, org, ["finance:view"])
    creator = authed_client_factory(member_user)
    reviewer_client = authed_client_factory(reviewer)
    proposer_client = authed_client_factory(proposer)
    viewer_client = authed_client_factory(viewer)

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
    manager_correction = await reviewer_client.patch(
        f"/finance/budget-submissions/{submission.json()['id']}/allocations/"
        f"{allocation.json()['id']}",
        json={
            "node_id": leaf.json()["id"],
            "quantity": 25,
            "unit": "件",
            "unit_price": 200,
            "proposing_org_id": str(org.id),
            "note": "由預算幹部接手確認",
        },
    )
    assert manager_correction.status_code == 200
    uploaded = await creator.post(
        f"/finance/ledgers/{ledger.id}/evidence",
        files={"file": ("估價單.pdf", b"%PDF-1.4\n%%EOF", "application/pdf")},
    )
    assert uploaded.status_code == 201
    evidence = await creator.post(
        f"/finance/budget-allocations/{allocation.json()['id']}/evidence",
        json={**uploaded.json(), "note": "廠商估價單"},
    )
    assert evidence.status_code == 201
    assert evidence.json()["filename"] == "估價單.pdf"
    unauthorized_evidence = await proposer_client.post(
        f"/finance/budget-allocations/{allocation.json()['id']}/evidence",
        json=uploaded.json(),
    )
    assert unauthorized_evidence.status_code == 403
    viewer_detail = await viewer_client.get(f"/finance/budgets/{budget.json()['id']}")
    assert viewer_detail.status_code == 200
    assert viewer_detail.json()["allocations"][0]["evidence"] == []
    assert (await viewer_client.get(evidence.json()["url"])).status_code == 403
    downloaded = await creator.get(evidence.json()["url"])
    assert downloaded.status_code == 200
    submitted = await creator.post(f"/finance/budget-submissions/{submission.json()['id']}/submit")
    assert submitted.json()["status"] == "submitted"
    approved = await creator.post(
        f"/finance/budget-submissions/{submission.json()['id']}/review",
        json={"status": "approved", "council_approved_on": "2026-08-19"},
    )
    assert approved.json()["status"] == "approved"
    detail = await creator.get(f"/finance/budgets/{budget.json()['id']}")
    assert detail.status_code == 200
    leaf_detail = next(item for item in detail.json()["nodes"] if item["id"] == leaf.json()["id"])
    assert leaf_detail["allocated_amount"] == 5000
    assert detail.json()["allocations"][0]["evidence"][0]["note"] == "廠商估價單"

    other_department = Org(name="行政部")
    db_session.add(other_department)
    await db_session.flush()
    forbidden_department_update = await viewer_client.patch(
        f"/finance/budget-allocations/{allocation.json()['id']}",
        json={"proposing_org_id": str(other_department.id), "reason": "不應允許"},
    )
    assert forbidden_department_update.status_code == 403
    revised = await creator.patch(
        f"/finance/budget-allocations/{allocation.json()['id']}",
        json={
            "quantity": 30,
            "unit": "件",
            "unit_price": 200,
            "amount": 6000,
            "proposing_org_id": str(other_department.id),
            "note": "依核准數量修正",
            "reason": "議決增列五件",
        },
    )
    assert revised.status_code == 200
    assert revised.json()["amount"] == 6000
    assert revised.json()["proposing_org_id"] == str(other_department.id)
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
    assert public_detail.json()["allocations"][0]["amount"] == 6000
    assert "proposed_by_id" not in public_detail.json()["allocations"][0]
    assert "evidence" not in public_detail.json()["allocations"][0]


async def test_budget_drafts_can_be_edited_and_deleted_by_their_creator(
    db_session, member_user, make_user, authed_client_factory
) -> None:
    proposer = await make_user(email="budget-other-proposer@school.edu")
    viewer = await make_user(email="budget-draft-viewer@school.edu")
    org = await _grant_many(
        db_session,
        [member_user],
        ["finance:view", "finance:budget", "finance:budget_propose"],
    )
    await _grant_on_org(db_session, proposer, org, ["finance:budget_propose"])
    await _grant_on_org(db_session, viewer, org, ["finance:view"])
    ledger, period, _, _ = await _make_ledger(db_session, org)
    creator_client = authed_client_factory(member_user)
    proposer_client = authed_client_factory(proposer)
    viewer_client = authed_client_factory(viewer)

    budget = await creator_client.post(
        f"/finance/ledgers/{ledger.id}/budgets",
        json={"period_id": str(period.id), "name": "可編輯草案測試"},
    )
    renamed_budget = await creator_client.patch(
        f"/finance/budgets/{budget.json()['id']}", json={"name": "已編輯共同預算"}
    )
    assert renamed_budget.status_code == 200
    assert renamed_budget.json()["name"] == "已編輯共同預算"
    assert (
        await viewer_client.patch(
            f"/finance/budgets/{budget.json()['id']}", json={"name": "無權修改"}
        )
    ).status_code == 403
    submission = await creator_client.post(
        f"/finance/budgets/{budget.json()['id']}/submissions",
        json={"kind": "initial", "title": "原始草案名稱"},
    )
    node = await creator_client.post(
        f"/finance/budget-submissions/{submission.json()['id']}/nodes",
        json={"name": "行政支出"},
    )
    allocation = await creator_client.post(
        f"/finance/budget-submissions/{submission.json()['id']}/allocations",
        json={
            "node_id": node.json()["id"],
            "amount": 500,
            "proposing_org_id": str(org.id),
        },
    )
    submission_id = submission.json()["id"]
    allocation_id = allocation.json()["id"]
    title_update = await creator_client.patch(
        f"/finance/budget-submissions/{submission_id}",
        json={"title": "已修改草案名稱"},
    )
    assert title_update.status_code == 200
    assert title_update.json()["title"] == "已修改草案名稱"
    assert (
        await proposer_client.patch(
            f"/finance/budget-submissions/{submission_id}", json={"title": "越權修改"}
        )
    ).status_code == 403
    assert (
        await proposer_client.delete(
            f"/finance/budget-submissions/{submission_id}/allocations/{allocation_id}"
        )
    ).status_code == 403
    assert (
        await viewer_client.delete(f"/finance/budget-submissions/{submission_id}")
    ).status_code == 403
    deleted_allocation = await creator_client.delete(
        f"/finance/budget-submissions/{submission_id}/allocations/{allocation_id}"
    )
    assert deleted_allocation.status_code == 204
    deleted_submission = await creator_client.delete(f"/finance/budget-submissions/{submission_id}")
    assert deleted_submission.status_code == 204
