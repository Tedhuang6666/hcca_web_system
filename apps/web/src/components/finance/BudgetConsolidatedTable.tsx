"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
import type { FinanceBudgetDetail, FinanceBudgetIncomeItem } from "@/lib/types";
import { consolidatedBudgetRows } from "./budgetWorkbook";
import "./budget-workbook.css";

type Props = {
  detail: FinanceBudgetDetail;
  canRecordIncome: boolean;
  canRecordExpense: boolean;
  onRegisterIncome: (item: FinanceBudgetIncomeItem) => void;
  onRegisterExpense: (nodeId: string) => void;
};
const money = (amount: number) => `NT$${amount.toLocaleString("zh-TW")}`;

export default function BudgetConsolidatedTable({ detail, canRecordIncome, canRecordExpense, onRegisterIncome, onRegisterExpense }: Props) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const rows = useMemo(() => consolidatedBudgetRows(detail), [detail]);
  const visible = rows.filter((row) => (
    (filter === "all" || (filter === "income" && row.income) || (filter === "expense" && !row.income) || (filter === "new" && row.isNew))
    && `${row.category} ${row.name} ${row.note || ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ));
  const income = rows.filter((row) => row.income).reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter((row) => !row.income).reduce((sum, row) => sum + row.amount, 0);
  const actualFor = (row: typeof rows[number]) => row.income
    ? (detail.income_records || []).filter((record) => record.category === row.category && record.name === row.name).reduce((sum, record) => sum + record.amount, 0)
    : detail.nodes.find((node) => node.id === row.allocation?.node_id)?.used_amount || 0;
  const exportWorkbook = async () => {
    setExporting(true);
    try { await financeApi.exportBudget(detail.id); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "匯出失敗，請重試"); }
    finally { setExporting(false); }
  };

  return <section className="finance-budget__section budget-workbook" aria-labelledby="consolidated-budget-heading">
    <header><h2 id="consolidated-budget-heading">收支總表</h2><button className="btn btn-secondary" type="button" disabled={exporting || rows.length === 0} onClick={() => void exportWorkbook()}><Download size={16} aria-hidden="true" />{exporting ? "匯出中…" : "匯出 Excel"}</button></header>
    <dl className="budget-workbook__totals"><div><dt>預算收入</dt><dd>{money(income)}</dd></div><div><dt>預算支出</dt><dd>{money(expense)}</dd></div><div><dt>預計結餘</dt><dd>{money(income - expense)}</dd></div></dl>
    <div className="budget-workbook__tools">
      <label className="budget-workbook__search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜尋預算明細</span><input className="input" type="search" placeholder="搜尋項目、細項或備註" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label><span className="sr-only">篩選預算</span><select className="input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部收支</option><option value="income">收入</option><option value="expense">支出</option><option value="new">本次新增</option></select></label>
      <span>{visible.length} 筆</span>
    </div>
    {detail.current_plan.changes.length > 0 && <details className="budget-workbook__changes"><summary>查看版本差異（{detail.current_plan.changes.length} 項）</summary><ul>{detail.current_plan.changes.map((change) => <li key={change.name}><span>{change.name}</span><span>{money(change.before)} → {money(change.after)}</span></li>)}</ul></details>}
    <div className="budget-workbook__scroll" role="region" aria-label="收支總表，可左右捲動" tabIndex={0}>
      <table><thead><tr><th scope="col">項目／細項</th><th scope="col">預算金額</th><th scope="col">實際收支</th><th scope="col">差額</th><th scope="col">狀況</th><th scope="col">操作</th></tr></thead><tbody>
        {visible.map((row) => {
          const actual = actualFor(row);
          const complete = actual >= row.amount;
          const status = actual === 0 ? (row.income ? "未收款" : "未支出") : complete ? (row.income ? "已收足" : actual > row.amount ? "超出預算" : "已支出") : (row.income ? "部分收款" : "部分支出");
          return <tr key={row.id} className={row.isNew ? "budget-workbook__new-row" : ""}>
            <th scope="row" data-label="項目／細項"><small>{row.category} · {row.income ? "收入" : "支出"}</small><strong>{row.name}</strong>{row.isNew && <span className="budget-workbook__new-label">新增</span>}<small>{row.quantity == null ? "" : `${row.quantity}${row.unit || ""}`}{row.unitPrice ? ` × ${money(row.unitPrice)}` : ""}</small>{row.note && <details><summary>備註</summary><p>{row.note}</p></details>}</th>
            <td data-label="預算金額">{money(row.amount)}</td>
            <td data-label={row.income ? "實收" : "已支出"} className={row.income ? "budget-workbook__income" : "budget-workbook__expense"}>{money(actual)}</td>
            <td data-label={row.income ? "尚未收款" : "可用餘額"}>{money(row.amount - actual)}</td>
            <td data-label="狀況"><span className="budget-workbook__status">{status}</span></td>
            <td data-label="操作"><div className="budget-workbook__actions">
              {row.incomeItem && canRecordIncome && <button className="btn btn-secondary" type="button" aria-label={`登記收入：${row.name}`} onClick={() => onRegisterIncome(row.incomeItem!)}>登記收入</button>}
              {row.allocation && canRecordExpense && <button className="btn btn-secondary" type="button" aria-label={`登記支出：${row.name}`} onClick={() => onRegisterExpense(row.allocation!.node_id)}>登記支出</button>}
            </div></td>
          </tr>;
        })}
      </tbody></table>
      {visible.length === 0 && <p className="budget-workbook__empty" role="status">{rows.length ? "沒有符合條件的預算明細。" : "目前沒有預算明細。"}</p>}
    </div>
  </section>;
}
