import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FinanceBudgetDetail, FinanceBudgetExpenseOut } from "@/lib/types";
import { budgetVersionChanges, consolidatedBudgetRows, effectiveSubmissionIds } from "./budgetWorkbook";
import BudgetConsolidatedTable from "./BudgetConsolidatedTable";
import BudgetAdvanceReceipts from "./BudgetAdvanceReceipts";
import { financeApi } from "@/lib/api";

vi.mock("@/lib/api", () => ({ financeApi: {
  exportAdvanceReceipt: vi.fn().mockResolvedValue(undefined),
  updateBudgetIncomeItem: vi.fn().mockResolvedValue({}),
  updateBudgetAllocation: vi.fn().mockResolvedValue({}),
} }));

const initial = { id: "initial", budget_id: "budget", kind: "initial", status: "approved", title: "初始", created_by_id: "operator", is_council_review_public: false, is_full_snapshot: true } as const;
const latest = { ...initial, id: "latest", kind: "supplemental", title: "第一次追加" } as const;
const detail: FinanceBudgetDetail = {
  id: "budget", ledger_id: "ledger", period_id: "period", name: "學期預算", is_public: true,
  submissions: [initial, latest],
  nodes: [{ id: "category", budget_id: "budget", name: "行政", sort_order: 0, allocated_amount: 0, used_amount: 0, remaining_amount: 0 }, { id: "paper", budget_id: "budget", parent_id: "category", name: "影印紙", sort_order: 1, allocated_amount: 400, used_amount: 0, remaining_amount: 400 }],
  allocations: [
    { id: "old-paper", submission_id: "initial", node_id: "paper", amount: 200, quantity: 2, unit: "包", unit_price: 100, proposed_by_id: "operator", proposing_org_id: "org", evidence: [] },
    { id: "new-paper", submission_id: "latest", node_id: "paper", amount: 400, quantity: 4, unit: "包", unit_price: 100, is_new: true, proposed_by_id: "operator", proposing_org_id: "org", evidence: [] },
  ],
  income_items: [{ id: "income", submission_id: "latest", category: "活動", name: "報名費", amount: 1000, source_row_number: 3 }],
  expenses: [],
};

describe("integrated budget workbook", () => {
  it("uses the latest full workbook and reports amount changes", () => {
    expect([...effectiveSubmissionIds(detail.submissions)]).toEqual(["latest"]);
    expect(consolidatedBudgetRows(detail).map((row) => row.amount)).toEqual([400, 1000]);
    expect(budgetVersionChanges(detail).map((change) => [change.before, change.after])).toEqual([[200, 400], [0, 1000]]);
  });

  it("keeps additions and ignores rejected or unapproved snapshots", () => {
    const submissions = [initial, { ...latest, is_full_snapshot: false }, { ...latest, id: "draft", status: "draft" as const }];
    expect([...effectiveSubmissionIds(submissions)]).toEqual(["initial", "latest"]);
    expect(consolidatedBudgetRows({ ...detail, submissions }).filter((row) => !row.income).reduce((sum, row) => sum + row.amount, 0)).toBe(600);
  });

  it("filters new rows and directly saves income with an explicit null note", async () => {
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<BudgetConsolidatedTable detail={detail} canManage canRecordExpense canRecordIncome onRegisterIncome={vi.fn()} onRegisterExpense={vi.fn()} onSaved={saved} />);
    const region = screen.getByRole("region", { name: "整合預算總表，可左右捲動" });
    expect(within(region).getByText("報名費")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "篩選預算" }), { target: { value: "new" } });
    expect(within(region).queryByText("報名費")).not.toBeInTheDocument();
    expect(within(region).getByText("影印紙")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "篩選預算" }), { target: { value: "income" } });
    fireEvent.click(within(region).getByRole("button", { name: "編輯" }));
    fireEvent.change(screen.getByLabelText("總額（含稅）"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存修改" }));
    await vi.waitFor(() => expect(financeApi.updateBudgetIncomeItem).toHaveBeenCalledWith("budget", "income", { amount: 1200, note: null }));
    expect(saved).toHaveBeenCalledOnce();
  });

  it("generates a receipt for selected actual advances only", async () => {
    const expense = (id: string, name: string | null, amount: number): FinanceBudgetExpenseOut => ({ id, budget_id: "budget", allocation_id: "paper", department_org_id: "org", department_name: "財務", allocation_node_id: "paper", allocation_name: "影印紙", entry_date: "2026-08-20", purpose: `採購 ${id}`, total_amount: amount, advanced_by_name: name, note: null, items: [], evidence: [], created_at: "2026-08-20T00:00:00Z" });
    render(<BudgetAdvanceReceipts budgetId="budget" expenses={[expense("one", "代墊人甲", 100), expense("two", "代墊人甲", 200), expense("direct", null, 50)]} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "下載 Word 簽收單" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "全選代墊支出" }));
    expect(screen.getByText("已選 2 筆 · NT$300")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "下載 Word 簽收單" }));
    await vi.waitFor(() => expect(financeApi.exportAdvanceReceipt).toHaveBeenCalledWith("budget", ["one"]));
  });
});
