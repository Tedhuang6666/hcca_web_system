"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { financeApi } from "@/lib/api";
import type { FinanceBudgetExpenseOut } from "@/lib/types";

export default function BudgetAdvanceReceipts({ budgetId, expenses }: { budgetId: string; expenses: FinanceBudgetExpenseOut[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const advances = expenses.filter((expense) => expense.advanced_by_name);
  const chosen = advances.filter((expense) => selected.has(expense.id));
  const total = chosen.reduce((sum, expense) => sum + expense.total_amount, 0);
  const groups = new Map<string, number>();
  for (const expense of chosen) groups.set(expense.advanced_by_name!, (groups.get(expense.advanced_by_name!) || 0) + expense.total_amount);

  const download = async () => {
    if (!chosen.length || downloading) return;
    setDownloading(true);
    setError("");
    try { await financeApi.exportAdvanceReceipt(budgetId, chosen.map((expense) => expense.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "下載失敗，請重試"); }
    finally { setDownloading(false); }
  };

  return <section className="finance-budget__section budget-advance-receipts" aria-labelledby="budget-advance-heading">
    <header><div><h3 id="budget-advance-heading">代墊簽收單</h3><p>勾選實際代墊支出，依代墊人彙整為 Word 簽收單，列出明細、合計與空白簽名欄。</p></div></header>
    {advances.length === 0 ? <p className="budget-workbook__empty">登記支出時填寫「代墊人」，就能在這裡產生簽收單。</p> : <>
      <button className="btn btn-secondary" type="button" onClick={() => setSelected(chosen.length === advances.length ? new Set() : new Set(advances.map((expense) => expense.id)))}>{chosen.length === advances.length ? "取消全選" : "全選代墊支出"}</button>
      <div className="budget-advance-receipts__list">{advances.map((expense) => <label key={expense.id}>
        <input type="checkbox" checked={selected.has(expense.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(expense.id); else next.delete(expense.id); return next; })} />
        <span><strong>{expense.advanced_by_name} · {expense.purpose}</strong><small>{expense.entry_date} · {expense.allocation_name}</small></span><b>NT${expense.total_amount.toLocaleString()}</b>
      </label>)}</div>
      <div className="budget-advance-receipts__footer"><div><strong>已選 {chosen.length} 筆 · NT${total.toLocaleString()}</strong>{[...groups].map(([name, amount]) => <p key={name}>{name}：NT${amount.toLocaleString()}</p>)}</div><button className="btn btn-primary" type="button" disabled={!chosen.length || downloading || chosen.length > 300} onClick={() => void download()}><Download size={16} aria-hidden="true" />{downloading ? "正在產生…" : "下載 Word 簽收單"}</button></div>
      {chosen.length > 300 && <p role="alert">一次最多產生 300 筆，請減少選取數量。</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
