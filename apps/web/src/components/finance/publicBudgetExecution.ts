import type {
  FinanceBudgetNode,
  PublicBudgetDetail,
  PublicBudgetExpenseOut,
  PublicBudgetListItem,
  PublicBudgetAllocation,
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
  incomeRecords?: NonNullable<PublicBudgetDetail["income_records"]>;
  allocations?: PublicBudgetAllocation[];
  category?: string;
  categoryId?: string;
  income?: boolean;
  historical?: boolean;
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
  const allocatedNodeIds = new Set(budget.allocations.map((allocation) => allocation.node_id));
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
        || allocatedNodeIds.has(node.id)
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
      allocations: budget.allocations.filter((allocation) => allocation.node_id === node.id),
    }));
}

/** Keep workbook income beside the spending for the same activity. */
export function publicBudgetWorkbookLines(
  budget: PublicBudgetDetail,
  summary: PublicBudgetListItem,
): PublicBudgetExecutionLine[] {
  const categories = new Map<string, string>();
  let category = summary.name;
  let categoryId = summary.id;
  const lines = budgetExecutionLines(budget, summary).map((line) => {
    if (line.depth === 0) {
      category = line.name;
      categoryId = line.id;
      if (!categories.has(category)) categories.set(category, categoryId);
    }
    return { ...line, category, categoryId };
  });
  const recordsByItem = new Map<string, NonNullable<PublicBudgetDetail["income_records"]>>();
  for (const record of budget.income_records ?? []) {
    const records = recordsByItem.get(record.income_item_id) ?? [];
    records.push(record);
    recordsByItem.set(record.income_item_id, records);
  }
  const items = budget.income_items ?? [];
  const planned = new Set(items.map((item) => item.id));
  const incomeLines: PublicBudgetExecutionLine[] = items.map((item) => ({
    id: `${summary.id}-income-${item.id}`,
    budgetName: summary.name,
    category: item.category,
    categoryId: categories.get(item.category) ?? `${summary.id}-income-${item.category}`,
    name: item.name,
    allocated: item.amount,
    spent: (recordsByItem.get(item.id) ?? []).reduce((sum, record) => sum + record.amount, 0),
    incomeRecords: recordsByItem.get(item.id) ?? [],
    remaining: 0,
    depth: 1,
    isGroup: false,
    isBudgetStart: false,
    income: true,
    expenses: [],
    allocations: [{ ...item, node_id: item.id }],
  }));
  // A revised workbook can remove an income item after money was received.
  for (const [itemId, records] of recordsByItem) {
    if (planned.has(itemId)) continue;
    const record = records[0];
    incomeLines.push({
      id: `${summary.id}-historical-income-${itemId}`,
      budgetName: summary.name,
      category: record.category,
      categoryId: categories.get(record.category) ?? `${summary.id}-income-${record.category}`,
      name: record.name,
      allocated: 0,
      spent: records.reduce((sum, record) => sum + record.amount, 0),
      incomeRecords: records,
      remaining: 0,
      depth: 1,
      isGroup: false,
      isBudgetStart: false,
      income: true,
      historical: true,
      expenses: [],
    });
  }
  return [...lines, ...incomeLines];
}

export function publicBudgetTotals(lines: PublicBudgetExecutionLine[]) {
  let incomeBudget = 0;
  let incomeReceived = 0;
  let expenseBudget = 0;
  let expenseSpent = 0;
  for (const line of lines) {
    if (line.income) {
      incomeBudget += line.allocated;
      incomeReceived += line.spent;
    } else {
      expenseBudget += line.allocated;
      expenseSpent += line.spent;
    }
  }
  return { incomeBudget, incomeReceived, expenseBudget, expenseSpent, difference: incomeReceived - expenseSpent };
}

export function groupPublicBudgetLines(lines: PublicBudgetExecutionLine[]) {
  const groups = new Map<string, {
    id: string;
    name: string;
    budgetName: string;
    lines: PublicBudgetExecutionLine[];
  }>();
  for (const line of lines) {
    const id = line.categoryId ?? line.budgetName;
    const group = groups.get(id) ?? {
      id,
      name: line.category ?? line.budgetName,
      budgetName: line.budgetName,
      lines: [],
    };
    // The activity heading already names a root that has no activity of its own.
    if (!line.isGroup || line.depth > 0 || line.allocated !== 0 || line.spent !== 0 || line.expenses.length > 0) {
      group.lines.push(line);
    }
    groups.set(id, group);
  }
  return Array.from(groups.values(), (group) => ({ ...group, ...publicBudgetTotals(group.lines) }));
}
