import type { FinanceBudgetDetail, FinanceBudgetSubmission } from "@/lib/types";

export function effectiveSubmissionIds(submissions: FinanceBudgetSubmission[]): Set<string> {
  const ids = new Set<string>();
  for (const submission of submissions) {
    if (submission.status !== "approved") continue;
    if (submission.is_full_snapshot) ids.clear();
    ids.add(submission.id);
  }
  return ids;
}

export function consolidatedBudgetRows(detail: FinanceBudgetDetail, ids = effectiveSubmissionIds(detail.submissions)) {
  const nodes = new Map(detail.nodes.map((node) => [node.id, node]));
  return [
    ...detail.allocations.filter((item) => ids.has(item.submission_id)).map((allocation) => {
      const node = nodes.get(allocation.node_id);
      const parent = node?.parent_id ? nodes.get(node.parent_id) : undefined;
      return {
        id: allocation.id, category: parent?.name || node?.name || "未分類",
        name: node?.name || "未命名細項", income: false,
        amount: allocation.amount, quantity: allocation.quantity, unit: allocation.unit,
        unitPrice: allocation.unit_price, note: allocation.note, isNew: allocation.is_new,
        allocation, incomeItem: undefined,
      };
    }),
    ...detail.income_items.filter((item) => ids.has(item.submission_id)).map((incomeItem) => ({
      id: incomeItem.id, category: incomeItem.category, name: incomeItem.name, income: true,
      amount: incomeItem.amount, quantity: incomeItem.quantity, unit: incomeItem.unit, unitPrice: incomeItem.unit_price,
      note: incomeItem.note, isNew: incomeItem.is_new, allocation: undefined, incomeItem,
    })),
  ];
}

export function budgetVersionChanges(detail: FinanceBudgetDetail) {
  const approved = detail.submissions.filter((item) => item.status === "approved");
  if (approved.length < 2) return [];
  const latest = approved.at(-1)!;
  const before = consolidatedBudgetRows(detail, effectiveSubmissionIds(
    detail.submissions.slice(0, detail.submissions.findIndex((item) => item.id === latest.id)),
  ));
  const after = consolidatedBudgetRows(detail);
  const entries = new Map<string, { name: string; before: number; after: number }>();
  for (const [side, rows] of [["before", before], ["after", after]] as const) {
    for (const row of rows) {
      const key = JSON.stringify([row.category, row.name, row.income]);
      const entry = entries.get(key) || { name: `${row.category}／${row.name}（${row.income ? "收入" : "支出"}）`, before: 0, after: 0 };
      entry[side] += row.amount;
      entries.set(key, entry);
    }
  }
  return [...entries.values()].filter((entry) => entry.before !== entry.after);
}
