import { describe, expect, it } from "vitest";

import type { PublicBudgetDetail, PublicBudgetListItem } from "@/lib/types";
import { budgetExecutionLines, groupPublicBudgetLines, publicBudgetTotals, publicBudgetWorkbookLines } from "./publicBudgetExecution";

const budget: PublicBudgetDetail = {
  id: "budget-1",
  name: "115 年度預算",
  period_name: "115 年度上學期",
  visibility: "approved",
  submissions: [],
  nodes: [
    {
      id: "clothing-item",
      budget_id: "budget-1",
      parent_id: "clothing",
      name: "幹部會服",
      sort_order: 0,
      allocated_amount: 5_250,
      used_amount: 0,
      remaining_amount: 5_250,
    },
    {
      id: "dance-item",
      budget_id: "budget-1",
      parent_id: "dance",
      name: "燈光、音響、藝人",
      sort_order: 0,
      allocated_amount: 160_000,
      used_amount: 284,
      remaining_amount: 159_716,
    },
    {
      id: "dance",
      budget_id: "budget-1",
      parent_id: null,
      name: "聯合舞會",
      sort_order: 1,
      allocated_amount: 0,
      used_amount: 0,
      remaining_amount: 0,
    },
    {
      id: "clothing",
      budget_id: "budget-1",
      parent_id: null,
      name: "會服",
      sort_order: 2,
      allocated_amount: 0,
      used_amount: 0,
      remaining_amount: 0,
    },
  ],
  allocations: [],
  expenses: [
    {
      id: "expense-1",
      entry_date: "2026-10-04",
      created_at: "2026-10-04T13:49:00Z",
      purpose: "貼紙購買",
      allocation_node_id: "dance",
      allocation_name: "聯合舞會",
      total_amount: 284,
      items: [],
      evidence: [],
    },
  ],
};

const summary: PublicBudgetListItem = {
  id: budget.id,
  name: budget.name,
  period_name: budget.period_name,
  visibility: "approved",
};

describe("budgetExecutionLines", () => {
  it("keeps each category with its children and includes spending on a category row", () => {
    const lines = budgetExecutionLines(budget, summary);

    expect(lines.map((line) => [line.name, line.depth])).toEqual([
      ["聯合舞會", 0],
      ["燈光、音響、藝人", 1],
      ["會服", 0],
      ["幹部會服", 1],
    ]);
    expect(lines[0]).toMatchObject({
      isGroup: true,
      spent: 0,
      expenses: [{ id: "expense-1", total_amount: 284 }],
    });
  });
});

describe("public workbook", () => {
  const incomeItem = {
    id: "tickets", category: "聯合舞會", name: "預售票", income: true,
    amount: 100_000, quantity: 800, unit: "張", unit_price: 250,
    note: "兩校分帳", is_new: false,
  };

  it("retains explicitly budgeted zero-value items", () => {
    const lines = publicBudgetWorkbookLines({
      ...budget,
      nodes: [...budget.nodes, { id: "zero", budget_id: budget.id, parent_id: "dance", name: "備用物資", sort_order: 2, allocated_amount: 0, used_amount: 0, remaining_amount: 0 }],
      allocations: [{ id: "zero-allocation", node_id: "zero", amount: 0 }],
    }, summary);
    expect(lines.find((line) => line.name === "備用物資")).toMatchObject({ allocated: 0 });
  });

  it("keeps income with its activity without adding it to spending totals", () => {
    const lines = publicBudgetWorkbookLines({
      ...budget,
      income_items: [incomeItem],
      income_records: [{ id: "receipt", income_item_id: "tickets", entry_date: "2026-11-01", category: "聯合舞會", name: "預售票", amount: 400 }],
    }, summary);
    const groups = groupPublicBudgetLines(lines);
    const dance = groups.find((group) => group.name === "聯合舞會");

    expect(groups).toHaveLength(2);
    expect(dance).toMatchObject({ expenseBudget: 160_000, expenseSpent: 284, incomeBudget: 100_000, incomeReceived: 400, difference: 116 });
    expect(dance?.lines.find((line) => line.income)).toMatchObject({
      name: "預售票", allocated: 100_000, spent: 400,
      allocations: [{ quantity: 800, unit_price: 250, note: "兩校分帳" }],
    });
  });

  it("keeps historical receipts and income-only categories visible after a revision", () => {
    const lines = publicBudgetWorkbookLines({
      ...budget,
      income_records: [
        { id: "receipt-1", income_item_id: "old-item", entry_date: "2026-11-01", category: "迎新", name: "報名費", amount: 400 },
        { id: "receipt-2", income_item_id: "old-item", entry_date: "2026-11-02", category: "迎新", name: "報名費", amount: 100 },
      ],
    }, summary);
    const group = groupPublicBudgetLines(lines).find((item) => item.name === "迎新");

    expect(group).toMatchObject({ expenseBudget: 0, expenseSpent: 0, incomeBudget: 0, incomeReceived: 500, difference: 500 });
    expect(group?.lines).toMatchObject([{ name: "報名費", income: true, historical: true, spent: 500 }]);
  });

  it("keeps identically named activities in different budgets separate", () => {
    const groups = groupPublicBudgetLines([
      ...publicBudgetWorkbookLines(budget, summary),
      ...publicBudgetWorkbookLines(budget, { ...summary, id: "budget-2" }),
    ]);
    expect(groups.filter((group) => group.name === "聯合舞會")).toHaveLength(2);
  });

  it("matches same-named items by ID and retains receipts from a replaced item", () => {
    const lines = publicBudgetWorkbookLines({
      ...budget,
      income_items: [incomeItem, { ...incomeItem, id: "tickets-2", amount: 2000 }],
      income_records: [
        { id: "r1", income_item_id: "tickets", entry_date: "2026-11-01", category: incomeItem.category, name: incomeItem.name, amount: 100 },
        { id: "r2", income_item_id: "tickets-2", entry_date: "2026-11-02", category: incomeItem.category, name: incomeItem.name, amount: 200 },
        { id: "r3", income_item_id: "old-tickets", entry_date: "2026-11-03", category: incomeItem.category, name: incomeItem.name, amount: 300 },
      ],
    }, summary);

    expect(lines.filter((line) => line.income).map((line) => [line.spent, line.historical ?? false]))
      .toEqual([[100, false], [200, false], [300, true]]);
    expect(publicBudgetTotals(lines)).toEqual({ incomeBudget: 102_000, incomeReceived: 600, expenseBudget: 165_250, expenseSpent: 284, difference: 316 });
    expect(groupPublicBudgetLines(lines).reduce((sum, group) => sum + group.incomeReceived, 0)).toBe(600);
  });
});
