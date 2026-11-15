import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./EvidencePreview", () => ({
  PdfEvidenceViewer: ({ filename }: { filename: string }) => <div role="img" aria-label={`${filename} 第 1 頁`} />,
}));

import PublicBudgetExecutionTable, {
  type PublicBudgetExecutionLine,
} from "./PublicBudgetExecutionTable";

const line: PublicBudgetExecutionLine = {
  id: "budget-node-1",
  budgetName: "115 學年度預算",
  name: "網域費用（續約）",
  allocated: 756,
  spent: 756,
  remaining: 0,
  depth: 0,
  isGroup: false,
  isBudgetStart: true,
  expenses: [{
    id: "expense-1",
    allocation_node_id: "node-1",
    allocation_name: "網域費用（續約）",
    entry_date: "2026-10-01",
    created_at: "2026-10-03T16:30:00Z",
    purpose: "網域續約",
    total_amount: 756,
    items: [{
      id: "item-1",
      name: "網域續約一年",
      unit_price: 756,
      tax_rate: 0,
      quantity: "1",
      unit: "年",
      amount: 756,
    }],
    evidence: [
      {
        id: "evidence-1",
        filename: "網域續約收據.pdf",
        url: "/finance/public/budgets/budget-1/expenses/expense-1/evidence/evidence-1",
      },
      {
        id: "evidence-2",
        filename: "網域續約收據.jpg",
        url: "/finance/public/budgets/budget-1/expenses/expense-1/evidence/evidence-2",
      },
    ],
  }],
};

describe("PublicBudgetExecutionTable", () => {
  it("opens the selected budget line's expense and receipt details", async () => {
    render(<PublicBudgetExecutionTable lines={[line]} />);

    fireEvent.click(screen.getByRole("button", {
      name: "查看「網域費用（續約）」的支出紀錄與憑證",
    }));

    expect(await screen.findByRole("dialog", {
      name: "網域費用（續約）｜支出紀錄",
    })).toBeVisible();
    expect(screen.getByText("網域續約一年")).toBeVisible();
    expect(screen.getByText("登錄時間")).toBeVisible();
    expect(screen.queryByText("操作人")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "網域續約收據.pdf 第 1 頁" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "預覽 PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "網域續約收據.jpg 預覽" })).toBeVisible();
    expect(screen.getByRole("link", { name: "在新分頁檢視：網域續約收據.pdf" }))
      .toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("button", { name: "預覽憑證：網域續約收據.pdf" }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", {
      name: "網域費用（續約）｜支出紀錄",
    })).not.toBeInTheDocument());
  });

  it("explains when a budget line has no public expense records", async () => {
    render(<PublicBudgetExecutionTable lines={[{ ...line, expenses: [] }]} />);

    fireEvent.click(screen.getByRole("button", {
      name: "查看「網域費用（續約）」的支出紀錄與憑證",
    }));

    expect(await screen.findByText("這個預算項目目前沒有可公開的支出紀錄。"))
      .toBeVisible();
  });

  it("keeps a parent budget row's own spending visible and opens its records", async () => {
    render(<PublicBudgetExecutionTable lines={[{ ...line, isGroup: true }]} />);

    expect(screen.getAllByText("NT$756").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole("button", {
      name: "查看「網域費用（續約）」的支出紀錄與憑證",
    }));

    expect(await screen.findByRole("dialog", {
      name: "網域費用（續約）｜支出紀錄",
    })).toBeVisible();
    expect(screen.getByText("網域續約一年")).toBeVisible();
  });

  it("shows unavailable evidence as text while keeping expense records accessible", () => {
    render(<PublicBudgetExecutionTable lines={[{
      ...line, expenses: [{ ...line.expenses[0], evidence: [] }],
    }]} />);
    expect(screen.getByText("尚無公開憑證")).toBeVisible();
    expect(screen.queryByRole("button", { name: `查看收據：${line.name}` })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `查看「${line.name}」的支出紀錄與憑證` })).toBeEnabled();
  });

  it("omits operator information even if an older response supplies it", async () => {
    const legacyExpense = { ...line.expenses[0], operator_name: "測試操作人" };
    render(<PublicBudgetExecutionTable lines={[{ ...line, expenses: [legacyExpense] }]} />);
    fireEvent.click(screen.getByRole("button", { name: `查看「${line.name}」的支出紀錄與憑證` }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.queryByText("操作人")).not.toBeInTheDocument();
    expect(screen.queryByText("測試操作人")).not.toBeInTheDocument();
  });

  it("labels income by actual receipts without inventing an outstanding payment", () => {
    render(<PublicBudgetExecutionTable lines={[
      line,
      { ...line, id: "income", name: "票券收入", income: true, allocated: 1000, spent: 400, expenses: [] },
    ]} />);
    expect(screen.getByText("票券收入")).toBeVisible();
    expect(screen.getByText("收入")).toBeVisible();
    expect(screen.getAllByText("NT$400").length).toBeGreaterThan(0);
    expect(screen.queryByText("尚未收款")).not.toBeInTheDocument();
    expect(screen.queryByText("NT$600")).not.toBeInTheDocument();
  });

  it("opens individual income records and restores keyboard focus on close", async () => {
    render(<PublicBudgetExecutionTable lines={[{
      ...line, income: true, name: "票券收入", expenses: [],
      incomeRecords: [
        { id: "r1", income_item_id: "tickets", name: "票券收入", category: "舞會", amount: 300, entry_date: "2026-11-01" },
        { id: "r2", income_item_id: "tickets", name: "票券收入", category: "舞會", amount: 456, entry_date: "2026-11-02" },
      ],
    }]} />);
    const trigger = screen.getByRole("button", { name: "查看「票券收入」的收入紀錄" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "票券收入｜收入紀錄" });
    expect(dialog).toBeVisible();
    expect(screen.getByText("2 筆收入紀錄")).toBeVisible();
    expect(screen.getByText("2026/11/01")).toBeVisible();
    expect(screen.getByText("2026/11/02")).toBeVisible();
    expect(screen.getByText("NT$300")).toBeVisible();
    expect(screen.getByText("NT$456")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("shows the income empty state", async () => {
    render(<PublicBudgetExecutionTable lines={[{ ...line, income: true, expenses: [], incomeRecords: [] }]} />);
    fireEvent.click(screen.getByRole("button", { name: `查看「${line.name}」的收入紀錄` }));
    expect(await screen.findByText("這個預算項目目前沒有可公開的收入紀錄。")).toBeVisible();
  });
});
