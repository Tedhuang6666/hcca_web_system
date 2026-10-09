import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
    expect(screen.getByTitle("網域續約收據.pdf 預覽")).toBeVisible();
    expect(screen.getByRole("img", { name: "網域續約收據.jpg 預覽" })).toBeVisible();
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
});
