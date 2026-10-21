"use client";

import { useMemo, useState } from "react";
import { Download, Pencil, Save, Search, X } from "lucide-react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
import type { FinanceBudgetDetail, FinanceBudgetIncomeItem } from "@/lib/types";
import { budgetVersionChanges, consolidatedBudgetRows } from "./budgetWorkbook";
import "./budget-workbook.css";

type Props = {
  detail: FinanceBudgetDetail;
  canManage: boolean;
  canRecordIncome: boolean;
  canRecordExpense: boolean;
  onRegisterIncome: (item: FinanceBudgetIncomeItem, periodId: string) => void;
  onRegisterExpense: (nodeId: string) => void;
  onSaved: () => Promise<void>;
};

const money = (amount: number) => `NT$${amount.toLocaleString("zh-TW")}`;
type Row = ReturnType<typeof consolidatedBudgetRows>[number];

export default function BudgetConsolidatedTable({ detail, canManage, canRecordIncome, canRecordExpense, onRegisterIncome, onRegisterExpense, onSaved }: Props) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({ amount: "", quantity: "", unit: "", unitPrice: "", note: "", reason: "" });
  const rows = useMemo(() => consolidatedBudgetRows(detail), [detail]);
  const changes = useMemo(() => budgetVersionChanges(detail), [detail]);
  const visible = rows.filter((row) => (
    (filter === "all" || (filter === "income" && row.income) || (filter === "expense" && !row.income) || (filter === "new" && row.isNew))
    && `${row.category} ${row.name} ${row.note || ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  ));
  const income = rows.filter((row) => row.income).reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter((row) => !row.income).reduce((sum, row) => sum + row.amount, 0);
  const groupTotals = new Map<string, number>();
  for (const row of rows) groupTotals.set(row.category, (groupTotals.get(row.category) || 0) + row.amount * (row.income ? 1 : -1));

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setError("");
    setDraft({ amount: String(row.amount), quantity: String(row.quantity ?? ""), unit: row.unit || "", unitPrice: String(row.unitPrice ?? ""), note: row.note || "", reason: "" });
  };

  const save = async (event: React.FormEvent, row: Row) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const quantity = draft.quantity ? Number(draft.quantity) : undefined;
      const unitPrice = draft.unitPrice ? Number(draft.unitPrice) : null;
      const amount = !row.income && quantity && unitPrice ? Math.round(quantity * unitPrice) : Number(draft.amount);
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("請填寫正整數金額");
      if (row.incomeItem) {
        await financeApi.updateBudgetIncomeItem(detail.id, row.id, { amount, note: draft.note.trim() || null });
      } else if (row.allocation) {
        if (!draft.reason.trim()) throw new Error("請填寫修正原因");
        await financeApi.updateBudgetAllocation(row.id, {
          amount, ...(quantity ? { quantity, unit: draft.unit.trim(), unit_price: unitPrice } : {}),
          note: draft.note.trim() || null, reason: draft.reason.trim(),
        });
      }
      await onSaved();
      setEditingId(null);
      toast.success("預算總表已更新");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "儲存失敗，請重試");
    } finally { setSaving(false); }
  };

  const exportWorkbook = async () => {
    setExporting(true);
    try { await financeApi.exportBudget(detail.id); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "匯出失敗，請重試"); }
    finally { setExporting(false); }
  };

  return <section className="finance-budget__section budget-workbook" aria-labelledby="consolidated-budget-heading">
    <header>
      <div><h3 id="consolidated-budget-heading">整合預算總表</h3><p>直接查看與修正全部核定預算，或從明細登記收支。</p></div>
      <button className="btn btn-secondary" type="button" disabled={exporting || rows.length === 0} onClick={() => void exportWorkbook()}><Download size={16} aria-hidden="true" />{exporting ? "正在匯出…" : "匯出 Excel"}</button>
    </header>
    <dl className="budget-workbook__totals"><div><dt>預算收入</dt><dd>{money(income)}</dd></div><div><dt>預算支出</dt><dd>{money(expense)}</dd></div><div><dt>預計結餘</dt><dd>{money(income - expense)}</dd></div></dl>
    <div className="budget-workbook__tools">
      <label className="budget-workbook__search"><Search size={16} aria-hidden="true" /><span className="sr-only">搜尋預算明細</span><input className="input" type="search" placeholder="搜尋項目、細項或備註" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label><span className="sr-only">篩選預算</span><select className="input" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部收支</option><option value="income">收入</option><option value="expense">支出</option><option value="new">本次新增</option></select></label>
      <span className="budget-workbook__legend"><span className="is-new">橘：新增</span><span className="is-income">綠：收入</span><span className="is-expense">紅：支出</span></span>
    </div>
    {changes.length > 0 && <details className="budget-workbook__changes"><summary>與上一版相比，{changes.length} 項金額變更</summary><ul>{changes.map((change) => <li key={change.name}><span>{change.name}</span><span>{money(change.before)} → {money(change.after)}<b>（{change.after - change.before > 0 ? "+" : ""}{(change.after - change.before).toLocaleString()}）</b></span></li>)}</ul></details>}
    <div className="budget-workbook__scroll" role="region" aria-label="整合預算總表，可左右捲動" tabIndex={0}>
      <table><thead><tr><th>項目</th><th>細項</th><th>數量</th><th>單價</th><th>總額（含稅）</th><th>項目淨額</th><th>備註</th><th>操作</th></tr></thead>
        {visible.map((row) => <tbody key={row.id}>
          <tr className={row.isNew ? "budget-workbook__new-row" : ""}>
            <td data-label="項目">{row.category}</td><th scope="row" data-label="細項">{row.name}{row.isNew && <small className="budget-workbook__new-label">新增</small>}</th>
            <td data-label="數量">{row.quantity == null ? "—" : `${row.quantity}${row.unit || ""}`}</td><td data-label="單價">{row.unitPrice ? money(row.unitPrice) : "＊"}</td>
            <td data-label="總額（含稅）" className={row.income ? "budget-workbook__income" : "budget-workbook__expense"}><small>{row.income ? "收入" : "支出"}</small><strong>{money(row.amount)}</strong>{row.allocation && <small>已用 {money(detail.nodes.find((node) => node.id === row.allocation!.node_id)?.used_amount || 0)}</small>}</td>
            <td data-label="項目淨額">{money(groupTotals.get(row.category) || 0)}</td><td data-label="備註">{row.note || "—"}</td>
            <td data-label="操作"><div className="budget-workbook__actions">
              {canManage && <button className="btn btn-secondary" type="button" onClick={() => startEdit(row)}><Pencil size={14} aria-hidden="true" />編輯</button>}
              {row.income && row.incomeItem && canRecordIncome && <button className="btn btn-secondary" type="button" onClick={() => onRegisterIncome(row.incomeItem!, detail.period_id)}>登記收入</button>}
              {row.allocation && canRecordExpense && <button className="btn btn-secondary" type="button" onClick={() => onRegisterExpense(row.allocation!.node_id)}>登記支出</button>}
            </div></td>
          </tr>
          {editingId === row.id && <tr className="budget-workbook__editor-row"><td colSpan={8}>
            <form className="budget-workbook__editor" aria-label={`編輯${row.name}`} onSubmit={(event) => void save(event, row)}>
              {!row.income && row.quantity != null && <>
                <label>數量<input className="input" type="number" required min="0.01" step="0.01" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
                <label>單位<input className="input" required maxLength={32} value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label>
                <label>單價（＊可留空）<input className="input" type="number" min="1" step="1" value={draft.unitPrice} onChange={(event) => setDraft({ ...draft, unitPrice: event.target.value })} /></label>
              </>}
              <label>總額（含稅）<input className="input" required type="number" min="1" max="2000000000" step="1" disabled={!row.income && Boolean(draft.quantity && draft.unitPrice)} value={!row.income && draft.quantity && draft.unitPrice ? Math.round(Number(draft.quantity) * Number(draft.unitPrice)) : draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
              <label>備註<textarea className="input" maxLength={2000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
              {!row.income && <label>修正原因<input className="input" required maxLength={500} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} /></label>}
              {error && <p role="alert">{error}</p>}
              <div className="budget-workbook__actions"><button className="btn btn-primary" disabled={saving}><Save size={15} aria-hidden="true" />{saving ? "儲存中…" : "儲存修改"}</button><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setEditingId(null)}><X size={15} aria-hidden="true" />取消</button></div>
            </form>
          </td></tr>}
        </tbody>)}
      </table>
      {visible.length === 0 && <p className="budget-workbook__empty" role="status">{rows.length ? "沒有符合條件的預算明細。" : "匯入預算總表後，收入與支出會集中顯示在這裡。"}</p>}
    </div>
  </section>;
}
