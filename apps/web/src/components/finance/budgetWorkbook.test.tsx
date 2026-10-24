import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FinanceBudgetDetail, FinanceBudgetExpenseOut } from "@/lib/types";
import { consolidatedBudgetRows } from "./budgetWorkbook";
import BudgetConsolidatedTable from "./BudgetConsolidatedTable";
import BudgetAdvanceReceipts from "./BudgetAdvanceReceipts";
import BudgetExpenseRegister from "./BudgetExpenseRegister";
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
  current_plan: {
    submission_ids: ["latest"], allocation_ids: ["new-paper"], historical_expense_allocations: {},
    rows: [
      { id: "new-paper", category: "行政", name: "影印紙", income: false, amount: 400, quantity: 4, unit: "包", unit_price: 100, note: null, is_new: true },
      { id: "income", category: "活動", name: "報名費", income: true, amount: 1000, quantity: null, unit: null, unit_price: null, note: null, is_new: false },
    ],
    changes: [{ name: "行政／影印紙（支出）", before: 200, after: 400 }, { name: "活動／報名費（收入）", before: 0, after: 1000 }],
  },
};

describe("integrated budget workbook", () => {
  it("uses server-selected rows and retains their editing references", () => {
    const rows = consolidatedBudgetRows(detail);
    expect(rows.map((row) => row.amount)).toEqual([400, 1000]);
    expect(rows[0].allocation?.id).toBe("new-paper");
    expect(rows[1].incomeItem?.id).toBe("income");
    expect(rows.some((row) => row.id === "old-paper")).toBe(false);
  });

  it("renders server version changes without replaying submission history", () => {
    render(<BudgetConsolidatedTable detail={{ ...detail, submissions: [] }} canManage={false} canRecordExpense={false} canRecordIncome={false} onRegisterIncome={vi.fn()} onRegisterExpense={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("與上一版相比，2 項金額變更")).toBeInTheDocument();
    expect(screen.getByText("行政／影印紙（支出）")).toBeInTheDocument();
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

  it("uses server allocation choices and exposes only the granted historical edit", () => {
    const expense: FinanceBudgetExpenseOut = {
      id: "historical-expense", budget_id: "budget", allocation_id: "old-paper",
      department_org_id: "org", department_name: "財務", allocation_node_id: "paper",
      allocation_name: "影印紙", entry_date: "2026-08-20", purpose: "歷史支出", total_amount: 90,
      advanced_by_name: null, note: null, items: [], evidence: [], created_at: "2026-08-20T00:00:00Z",
    };
    render(<BudgetExpenseRegister
      budgetId="budget" ledgerId="ledger"
      allocations={[...detail.allocations, { ...detail.allocations[0], id: "unrelated-old", amount: 600 }]}
      currentPlan={{ ...detail.current_plan, historical_expense_allocations: { "historical-expense": "old-paper" } }}
      nodes={detail.nodes} expenses={[expense]} orgs={[]} canRecord quickNodeId={null}
      onQuickRegistrationHandled={vi.fn()} isPublic onRecorded={vi.fn().mockResolvedValue(undefined)}
    />);
    fireEvent.click(screen.getByRole("button", { name: "登記支出" }));
    const choiceValues = () => within(screen.getByLabelText("對應預算明細"))
      .getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(choiceValues()).toEqual(["", "new-paper"]);
    fireEvent.click(screen.getByRole("button", { name: "編輯支出" }));
    expect(choiceValues()).toEqual(["", "old-paper", "new-paper"]);
    expect(screen.getByLabelText("對應預算明細")).toHaveValue("old-paper");
  });
});
