import type { FinanceBudgetDetail } from "@/lib/types";

/** Attach editing references to the server's current-plan rows; version policy stays on the server. */
export function consolidatedBudgetRows(detail: FinanceBudgetDetail) {
  const allocations = new Map(detail.allocations.map((item) => [item.id, item]));
  const incomeItems = new Map(detail.income_items.map((item) => [item.id, item]));
  return detail.current_plan.rows.map((row) => ({
    ...row,
    unitPrice: row.unit_price,
    isNew: row.is_new,
    allocation: row.income ? undefined : allocations.get(row.id),
    incomeItem: row.income ? incomeItems.get(row.id) : undefined,
  }));
}
