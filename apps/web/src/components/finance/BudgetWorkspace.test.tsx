import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import BudgetWorkspace from "./BudgetWorkspace";
import { financeApi } from "@/lib/api";
import type { FinanceBudgetDetail, FinanceBudgetSubmission } from "@/lib/types";

vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock("./BudgetExpenseRegister", () => ({ default: () => <div>支出紀錄</div> }));
vi.mock("./BudgetIncomeRegister", () => ({ default: () => <div>收款紀錄</div> }));
vi.mock("./BudgetConsolidatedTable", () => ({ default: () => <div>收支總表</div> }));
vi.mock("@/lib/api", () => ({ financeApi: { listBudgets: vi.fn(), getBudget: vi.fn(), importBudget: vi.fn() } }));
const budget = { id: "budget", ledger_id: "ledger", period_id: "period", name: "學期預算", is_public: true };
const detail: FinanceBudgetDetail = { ...budget, nodes: [], submissions: [], income_items: [], expenses: [], allocations: [], current_plan: { submission_ids: [], allocation_ids: [], historical_expense_allocations: {}, rows: [], changes: [] } };
const submission: FinanceBudgetSubmission = { id: "version", budget_id: budget.id, kind: "initial", status: "approved", title: "已上傳預算", created_by_id: "user", is_council_review_public: false };
const props = { ledgerId: "ledger", periods: [{ id: "period", ledger_id: "ledger", name: "115年度上學期", starts_on: "2026-07-01", ends_on: "2026-12-31", is_closed: false }], orgs: [], canManage: true, canPublish: true, canRecordExpense: true, canRecordIncome: true };

beforeEach(() => {
  vi.mocked(financeApi.listBudgets).mockResolvedValue([budget]);
  vi.mocked(financeApi.getBudget).mockResolvedValue(detail);
  vi.mocked(financeApi.importBudget).mockResolvedValue({ budget, submission, categories_created: 12, allocations_created: 46, income_items_created: 10, skipped_rows: [] });
});

describe("simple budget workspace", () => {
  it("uploads a full snapshot into the existing budget without a proposal or approval date", async () => {
    render(<BudgetWorkspace {...props} />);
    await screen.findByText("收支總表");
    expect(screen.queryByText("建立追加草案")).not.toBeInTheDocument();
    expect(screen.queryByText("預算版本與草案編輯")).not.toBeInTheDocument();
    const file = new File(["xlsx"], "115年度上學期第二次追加預算.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    await userEvent.upload(screen.getByLabelText("Excel 預算檔"), file);
    expect((screen.getByLabelText("Excel 預算檔") as HTMLInputElement).files?.[0]).toBe(file);
    expect(screen.getByLabelText("會計期間")).toHaveValue("period");
    // JSDOM does not update native file-input validity. Native submission is
    // covered by the real-browser upload; dispatch the React form event here.
    fireEvent.submit(screen.getByRole("button", { name: "上傳並公開" }).closest("form")!);
    await waitFor(() => expect(financeApi.importBudget).toHaveBeenCalledWith("ledger", { file, period_id: "period", name: "學期預算", budget_id: "budget", full_snapshot: true }));
    expect(await screen.findByText("已更新 46 筆支出預算、10 筆收入預算。")).toBeVisible();
  });
  it("keeps parse errors beside the upload and retains the selected file", async () => {
    vi.mocked(financeApi.importBudget).mockRejectedValueOnce(new Error("找不到預算表欄位"));
    render(<BudgetWorkspace {...props} />);
    await screen.findByText("收支總表");
    const file = new File(["xlsx"], "預算.xlsx");
    await userEvent.upload(screen.getByLabelText("Excel 預算檔"), file);
    fireEvent.submit(screen.getByRole("button", { name: "上傳並公開" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("找不到預算表欄位");
    expect(screen.getByRole("button", { name: "上傳並公開" })).toBeEnabled();
  });
});
