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
    operator_name: "王小明",
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
    expect(screen.getByText("操作人")).toBeVisible();
    expect(screen.getByText("王小明")).toBeVisible();
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

  it("preserves the detail page's choice to omit the operator", async () => {
    render(<PublicBudgetExecutionTable lines={[line]} showOperator={false} />);
    fireEvent.click(screen.getByRole("button", { name: `查看「${line.name}」的支出紀錄與憑證` }));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.queryByText("操作人")).not.toBeInTheDocument();
    expect(screen.queryByText("王小明")).not.toBeInTheDocument();
  });

  it("labels income by actual receipts without inventing an outstanding payment", () => {
    render(<PublicBudgetExecutionTable lines={[
      line,
      { ...line, id: "income", name: "票券收入", income: true, allocated: 1000, spent: 400, expenses: [] },
    ]} />);
    expect(screen.getByText("票券收入")).toBeVisible();
    expect(screen.getByText("收入")).toBeVisible();
    expect(screen.getByText("NT$400")).toBeVisible();
    expect(screen.queryByText("尚未收款")).not.toBeInTheDocument();
    expect(screen.queryByText("NT$600")).not.toBeInTheDocument();
  });
});
