import type {
  FinanceBudgetNode,
  PublicBudgetDetail,
  PublicBudgetExpenseOut,
  PublicBudgetListItem,
} from "@/lib/types";

export type PublicBudgetExecutionLine = {
  id: string;
  budgetName: string;
  name: string;
  allocated: number;
  spent: number;
  remaining: number;
  depth: number;
  isGroup: boolean;
  isBudgetStart: boolean;
  expenses: PublicBudgetExpenseOut[];
};

export function orderBudgetNodes(
  nodes: FinanceBudgetNode[],
): Array<{ node: FinanceBudgetNode; depth: number }> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const inputOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const childrenByParent = new Map<string | null, FinanceBudgetNode[]>();

  for (const node of nodes) {
    const parentId = node.parent_id && nodeIds.has(node.parent_id) ? node.parent_id : null;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(node);
    childrenByParent.set(parentId, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort((left, right) => (
      left.sort_order - right.sort_order
      || (inputOrder.get(left.id) ?? 0) - (inputOrder.get(right.id) ?? 0)
    ));
  }

  const ordered: Array<{ node: FinanceBudgetNode; depth: number }> = [];
  const visited = new Set<string>();
  const appendChildren = (parentId: string | null, depth: number) => {
    for (const node of childrenByParent.get(parentId) ?? []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      ordered.push({ node, depth });
      appendChildren(node.id, depth + 1);
    }
  };

  appendChildren(null, 0);

  // Keep malformed or cyclic data visible instead of dropping it or recursing forever.
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    ordered.push({ node, depth: 0 });
    appendChildren(node.id, 1);
  }

  return ordered;
}

export function budgetExecutionLines(
  budget: PublicBudgetDetail,
  summary: PublicBudgetListItem,
): PublicBudgetExecutionLine[] {
  const parentIds = new Set(budget.nodes.flatMap((node) => (
    node.parent_id ? [node.parent_id] : []
  )));
  const expensesByNode = new Map<string, PublicBudgetExpenseOut[]>();
  for (const expense of budget.expenses) {
    const expenses = expensesByNode.get(expense.allocation_node_id) ?? [];
    expenses.push(expense);
    expensesByNode.set(expense.allocation_node_id, expenses);
  }

  return orderBudgetNodes(budget.nodes)
    .filter(({ node }) => {
      const expenses = expensesByNode.get(node.id) ?? [];
      return node.allocated_amount > 0
        || node.used_amount > 0
        || parentIds.has(node.id)
        || expenses.length > 0;
    })
    .map(({ node, depth }, index) => ({
      id: `${summary.id}-${node.id}`,
      budgetName: summary.name,
      name: node.name,
      allocated: node.allocated_amount,
      spent: node.used_amount,
      remaining: node.remaining_amount,
      depth,
      isGroup: parentIds.has(node.id),
      isBudgetStart: index === 0,
      expenses: expensesByNode.get(node.id) ?? [],
    }));
}
