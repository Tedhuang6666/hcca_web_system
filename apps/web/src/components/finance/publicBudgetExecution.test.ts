import { describe, expect, it } from "vitest";

import type { PublicBudgetDetail, PublicBudgetListItem } from "@/lib/types";
import { budgetExecutionLines } from "./publicBudgetExecution";

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
      operator_name: "王小明",
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
