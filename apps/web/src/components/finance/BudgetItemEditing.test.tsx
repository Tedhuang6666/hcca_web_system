import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BudgetWorkspace from "./BudgetWorkspace";
import PublicBudgetExecutionTable from "./PublicBudgetExecutionTable";
import { budgetExecutionLines } from "./publicBudgetExecution";
import { financeApi } from "@/lib/api";
import type { FinanceBudgetDetail, FinanceBudgetExpenseOut } from "@/lib/types";

vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("./EvidencePreview", () => ({ default: ({ filename }: { filename: string }) => <span>{filename}</span> }));
vi.mock("@/lib/api", () => ({ financeApi: {
  listBudgets: vi.fn(), getBudget: vi.fn(), createBudgetExpense: vi.fn(),
  updateBudgetExpense: vi.fn(), uploadEvidence: vi.fn(),
  createBudgetIncomeRecord: vi.fn(), updateBudgetIncomeRecord: vi.fn(),
} }));

const paper = { id: "paper", submission_id: "current", node_id: "paper-node", amount: 500, proposing_org_id: "org", proposed_by_id: "user", evidence: [] };
const expense: FinanceBudgetExpenseOut = {
  id: "expense", budget_id: "budget", allocation_id: "old-paper", allocation_node_id: "paper-node", allocation_name: "影印紙",
  department_org_id: "org", department_name: "財務", entry_date: "2026-08-20", purpose: "影印紙採購", total_amount: 200,
  note: "可清空備註", items: [], advanced_by_name: null, created_at: "2026-08-20T00:00:00Z",
  evidence: [{ id: "evidence", filename: "原收據.pdf", url: "/finance/evidence/original", content_type: "application/pdf", file_size: 7, storage_key: "original", uploaded_at: "2026-08-20T00:00:00Z" }],
};
const income = { id: "income", submission_id: "current", category: "活動", name: "報名費", amount: 1000, source_row_number: 3 };
const budget = { id: "budget", ledger_id: "ledger", period_id: "period", name: "學期預算", is_public: true };
const detail: FinanceBudgetDetail = {
  ...budget, submissions: [],
  nodes: [{ id: "paper-node", budget_id: "budget", name: "影印紙", sort_order: 0, allocated_amount: 500, used_amount: 200, remaining_amount: 300 }],
  allocations: [paper, { ...paper, id: "old-paper", submission_id: "old" }],
  income_items: [income], expenses: [expense],
  income_records: [{ id: "receipt", income_item_id: "old-income", category: "活動", name: "報名費", amount: 400, entry_date: "2026-08-20", note: null }],
  current_plan: {
    submission_ids: ["current"], allocation_ids: [paper.id], historical_expense_allocations: { expense: "old-paper" }, changes: [],
    rows: [
      { id: paper.id, category: "行政", name: "影印紙", income: false, amount: 500, quantity: 5, unit: "包", unit_price: 100, note: null, is_new: false },
      { id: income.id, category: "活動", name: "報名費", income: true, amount: 1000, quantity: null, unit: null, unit_price: null, note: null, is_new: false },
    ],
  },
};
const props = {
  ledgerId: "ledger", periods: [{ id: "period", ledger_id: "ledger", name: "上學期", starts_on: "2026-07-01", ends_on: "2026-12-31", is_closed: false }],
  orgs: [{ id: "org", name: "財務", org_type: "department" as const, is_active: true, created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" }],
  canManage: true, canPublish: true, canRecordExpense: true, canRecordIncome: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(financeApi.listBudgets).mockResolvedValue([budget]);
  vi.mocked(financeApi.getBudget).mockResolvedValue(structuredClone(detail));
  vi.mocked(financeApi.updateBudgetExpense).mockResolvedValue(expense);
  vi.mocked(financeApi.createBudgetExpense).mockResolvedValue(expense);
  vi.mocked(financeApi.uploadEvidence).mockResolvedValue({ storage_key: "new", filename: "新收據.pdf", content_type: "application/pdf", file_size: 7 });
});

describe("editing from a budget row", () => {
  it("reduces a historical expense and adds a receipt in the selected row", async () => {
    const user = userEvent.setup();
    render(<BudgetWorkspace {...props} />);
    await user.click(await screen.findByRole("button", { name: "影印紙" }));
    const panel = screen.getByRole("region", { name: "影印紙收支紀錄" });
    expect(within(panel).getByText("原收據.pdf")).toBeVisible();
    expect(within(panel).queryByText("報名費")).not.toBeInTheDocument();
    await user.click(within(panel).getByRole("button", { name: "編輯支出" }));
    await user.clear(within(panel).getByLabelText("支出總額"));
    await user.type(within(panel).getByLabelText("支出總額"), "150");
    await user.clear(within(panel).getByLabelText("備註（選填）"));
    await user.upload(within(panel).getByLabelText("附上收據或憑證"), new File(["receipt"], "新收據.pdf", { type: "application/pdf" }));
    await user.click(within(panel).getByRole("button", { name: "更新支出" }));
    await waitFor(() => expect(financeApi.updateBudgetExpense).toHaveBeenCalledWith("budget", "expense", expect.objectContaining({
      allocation_id: "old-paper", total_amount: 150, note: null,
      evidence: [{ storage_key: "new", filename: "新收據.pdf", content_type: "application/pdf", file_size: 7 }],
    })));
    expect(financeApi.createBudgetExpense).not.toHaveBeenCalled();
    await waitFor(() => expect(within(panel).queryByLabelText("支出總額")).not.toBeInTheDocument());
  });

  it("starts a new expense with its item and department already selected", async () => {
    vi.mocked(financeApi.getBudget).mockResolvedValue({ ...detail, expenses: [] });
    render(<BudgetWorkspace {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "影印紙" }));
    expect(screen.queryByLabelText("對應預算明細")).not.toBeInTheDocument();
    expect(screen.getByLabelText("支出部門")).toHaveValue("org");
    expect(screen.getByLabelText("支出用途")).toHaveValue("影印紙");
    fireEvent.change(screen.getByLabelText("支出總額"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存支出" }));
    await waitFor(() => expect(financeApi.createBudgetExpense).toHaveBeenCalledWith("budget", expect.objectContaining({ allocation_id: "paper", department_org_id: "org", purpose: "影印紙", total_amount: 90 })));
  });

  it("discards the previous row's form when changing items", async () => {
    render(<BudgetWorkspace {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "影印紙" }));
    fireEvent.click(screen.getByRole("button", { name: "編輯支出" }));
    fireEvent.change(screen.getByLabelText("支出總額"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "報名費" }));
    expect(screen.queryByLabelText("支出總額")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "編輯收款" }));
    expect(screen.getByLabelText("實收金額")).toHaveValue(400);
    fireEvent.change(screen.getByLabelText("實收金額"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存收款" }));
    await waitFor(() => expect(financeApi.updateBudgetIncomeRecord).toHaveBeenCalledWith("budget", "receipt", { amount: 300, entry_date: "2026-08-20", note: null }));
  });

  it("preserves a failed expense for retry and shows the server error beside it", async () => {
    vi.mocked(financeApi.updateBudgetExpense).mockRejectedValueOnce(new Error("收據驗證失敗，請重新上傳"));
    render(<BudgetWorkspace {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: "影印紙" }));
    fireEvent.click(screen.getByRole("button", { name: "編輯支出" }));
    fireEvent.change(screen.getByLabelText("支出總額"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "更新支出" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("收據驗證失敗，請重新上傳");
    expect(screen.getByLabelText("支出總額")).toHaveValue(150);
    expect(screen.getByRole("button", { name: "更新支出" })).toBeEnabled();
  });

  it.each(["permission", "closed"])("allows reading but prevents changes when %s blocks editing", async (reason) => {
    render(<BudgetWorkspace {...props} canRecordExpense={reason !== "permission"} canRecordIncome={false} periods={props.periods.map((period) => ({ ...period, is_closed: reason === "closed" }))} />);
    fireEvent.click(await screen.findByRole("button", { name: "影印紙" }));
    expect(screen.getByText("原收據.pdf")).toBeVisible();
    expect(screen.queryByRole("button", { name: "編輯支出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新增支出" })).not.toBeInTheDocument();
  });
});

it("shows workbook quantities, unit prices, budget notes and receipt counts publicly", () => {
  const publicBudget = { id: "budget", name: "預算", period_name: "上學期", visibility: "approved" as const, submissions: [], nodes: detail.nodes, allocations: [{ id: "paper", node_id: "paper-node", amount: 500, quantity: 5, unit: "包", unit_price: 100, note: "依實際張數" }], expenses: [{ ...expense, operator_name: "測試人員" }] };
  render(<PublicBudgetExecutionTable lines={budgetExecutionLines(publicBudget, publicBudget)} />);
  expect(screen.getByText("5包")).toBeVisible();
  expect(screen.getByText("NT$100")).toBeVisible();
  expect(screen.getByText("依實際張數")).toBeVisible();
  expect(screen.getByRole("button", { name: "查看收據：影印紙" })).toHaveTextContent("1 份");
});
