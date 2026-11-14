import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BudgetIncomeRegister from "./BudgetIncomeRegister";
import type { FinanceBudgetDetail } from "@/lib/types";
import { financeApi } from "@/lib/api";

vi.mock("@/lib/api", () => ({ financeApi: { createBudgetIncomeRecord: vi.fn().mockResolvedValue({}), updateBudgetIncomeRecord: vi.fn().mockResolvedValue({}) } }));
const item = { id: "income", submission_id: "current", category: "活動", name: "報名費", amount: 1000, source_row_number: 3 };
const detail: FinanceBudgetDetail = { id: "budget", ledger_id: "ledger", period_id: "period", name: "學期預算", is_public: true, submissions: [], nodes: [], allocations: [], income_items: [item], expenses: [], income_records: [{ id: "old-record", income_item_id: "old-income", category: "活動", name: "報名費", amount: 400, entry_date: "2026-08-20", note: "上版收入" }], current_plan: { submission_ids: ["current"], allocation_ids: [], historical_expense_allocations: {}, rows: [], changes: [] } };

describe("direct budget income", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  it("carries receipts from the previous snapshot and records only the remaining income", async () => {
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<BudgetIncomeRegister detail={detail} canRecord quickIncome={item} onQuickRegistrationHandled={vi.fn()} onRecorded={saved} />);
    expect(screen.getByLabelText("實收金額")).toHaveValue(600);
    fireEvent.click(screen.getByRole("button", { name: "儲存收款" }));
    await waitFor(() => expect(financeApi.createBudgetIncomeRecord).toHaveBeenCalledWith("budget", expect.objectContaining({ income_item_id: "income", amount: 600, note: null })));
    expect(saved).toHaveBeenCalledOnce();
  });
  it("edits historical receipts without changing their original budget item", async () => {
    render(<BudgetIncomeRegister detail={detail} canRecord quickIncome={null} onQuickRegistrationHandled={vi.fn()} onRecorded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "編輯收款" }));
    expect(screen.getByLabelText("收入項目")).toBeDisabled();
    expect(screen.getByLabelText("收入項目")).toHaveValue("old-income");
    fireEvent.change(screen.getByLabelText("實收金額"), { target: { value: "350" } });
    fireEvent.change(screen.getByLabelText("內部備註"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存收款" }));
    await waitFor(() => expect(financeApi.updateBudgetIncomeRecord).toHaveBeenCalledWith("budget", "old-record", { amount: 350, entry_date: "2026-08-20", note: null }));
  });
  it("keeps failed writes visible and preserves the amount for retry", async () => {
    vi.mocked(financeApi.createBudgetIncomeRecord).mockRejectedValueOnce(new Error("收款日期不在會計期間"));
    render(<BudgetIncomeRegister detail={detail} canRecord quickIncome={item} onQuickRegistrationHandled={vi.fn()} onRecorded={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "儲存收款" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("收款日期不在會計期間");
    expect(screen.getByLabelText("實收金額")).toHaveValue(600);
  });
  it("closes a saved receipt even if refreshing the table fails", async () => {
    render(<BudgetIncomeRegister detail={detail} canRecord quickIncome={item} onQuickRegistrationHandled={vi.fn()} onRecorded={vi.fn().mockRejectedValue(new Error("重新載入失敗"))} />);
    fireEvent.click(screen.getByRole("button", { name: "儲存收款" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "儲存收款" })).not.toBeInTheDocument());
  });
});
