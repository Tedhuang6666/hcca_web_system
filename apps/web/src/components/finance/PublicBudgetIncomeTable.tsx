import type { FinanceBudgetPlanRow, FinanceBudgetIncomeRecord } from "@/lib/types";

type Props = {
  items: FinanceBudgetPlanRow[];
  records: Pick<FinanceBudgetIncomeRecord, "category" | "name" | "amount">[];
};
const money = (amount: number) => `NT$${amount.toLocaleString("zh-TW")}`;

export default function PublicBudgetIncomeTable({ items, records }: Props) {
  if (!items.length && !records.length) return null;
  const keyFor = (item: { category: string; name: string }) => JSON.stringify([item.category, item.name]);
  const planned = new Set(items.map(keyFor));
  const historical = new Map<string, Props["records"][number]>();
  for (const record of records) {
    const key = keyFor(record);
    if (planned.has(key)) continue;
    const previous = historical.get(key);
    historical.set(key, { ...record, amount: (previous?.amount || 0) + record.amount });
  }
  return <section className="public-budget-income" aria-label="收入預算與收款狀況">
    <h2>收入與收款狀況</h2>
    <table><thead><tr><th scope="col">收入項目</th><th scope="col">預算</th><th scope="col">實收</th><th scope="col">狀況</th></tr></thead><tbody>
      {items.map((item) => {
        const received = records.filter((record) => record.category === item.category && record.name === item.name).reduce((sum, record) => sum + record.amount, 0);
        return <tr key={item.id}><th scope="row"><small>{item.category}</small>{item.name}</th><td data-label="預算">{money(item.amount)}</td><td data-label="實收">{money(received)}</td><td data-label="狀況">{received === 0 ? "未收款" : received < item.amount ? "部分收款" : "已收足"}</td></tr>;
      })}
      {Array.from(historical, ([key, record]) => <tr key={key}><th scope="row"><small>{record.category} · 歷史收款</small>{record.name}</th><td data-label="預算">—</td><td data-label="實收">{money(record.amount)}</td><td data-label="狀況">已收款</td></tr>)}
    </tbody></table>
  </section>;
}
