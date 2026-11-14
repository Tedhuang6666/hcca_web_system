"use client";

import { useEffect, useRef, useState } from "react";
import { financeApi } from "@/lib/api";
import type { FinanceBudgetDetail, FinanceBudgetIncomeItem, FinanceBudgetIncomeRecord, PeriodOut } from "@/lib/types";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
type Props = {
  detail: FinanceBudgetDetail;
  period?: PeriodOut;
  canRecord: boolean;
  quickIncome: FinanceBudgetIncomeItem | null;
  onQuickRegistrationHandled: () => void;
  onRecorded: () => Promise<void>;
};

export default function BudgetIncomeRegister({ detail, period, canRecord, quickIncome, onQuickRegistrationHandled, onRecorded }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [incomeId, setIncomeId] = useState("");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const currentIds = new Set(detail.current_plan.submission_ids);
  const incomeItems = detail.income_items.filter((item) => currentIds.has(item.submission_id));
  const records = detail.income_records || [];

  useEffect(() => {
    if (!quickIncome) return;
    const received = (detail.income_records || []).filter((record) => record.category === quickIncome.category && record.name === quickIncome.name).reduce((sum, record) => sum + record.amount, 0);
    setIncomeId(quickIncome.id);
    setAmount(String(Math.max(quickIncome.amount - received, 0)));
    const day = today();
    setEntryDate(period && day < period.starts_on ? period.starts_on : period && day > period.ends_on ? period.ends_on : day);
    setNote("");
    setError("");
    setEditing(null);
    setOpen(true);
    onQuickRegistrationHandled();
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "nearest" }));
  }, [quickIncome, detail.income_records, period, onQuickRegistrationHandled]);

  const edit = (record: FinanceBudgetIncomeRecord) => {
    setEditing(record.id);
    setIncomeId(record.income_item_id);
    setAmount(String(record.amount));
    setEntryDate(record.entry_date);
    setNote(record.note || "");
    setError("");
    setOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "nearest" }));
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const body = { amount: Number(amount), entry_date: entryDate, note: note.trim() || null };
      if (!Number.isSafeInteger(body.amount) || body.amount <= 0) throw new Error("請填寫大於 0 的整數金額");
      if (editing) await financeApi.updateBudgetIncomeRecord(detail.id, editing, body);
      else await financeApi.createBudgetIncomeRecord(detail.id, { ...body, income_item_id: incomeId });
      setOpen(false);
      setEditing(null);
      await onRecorded();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "收入儲存失敗，請重試"); }
    finally { setSaving(false); }
  };

  return <section className="finance-budget__section finance-income" aria-labelledby="income-record-heading">
    <header><h2 id="income-record-heading">收款紀錄</h2><span>實收 NT${records.reduce((sum, record) => sum + record.amount, 0).toLocaleString("zh-TW")}</span></header>
    {open && canRecord && <form ref={formRef} className="finance-simple__setup" onSubmit={(event) => void save(event)} aria-label={editing ? "編輯收款" : "登記收入"}>
      <label>收入項目<select className="input" required disabled={Boolean(editing) || saving} value={incomeId} onChange={(event) => setIncomeId(event.target.value)}><option value="">選擇收入項目</option>{incomeItems.map((item) => <option key={item.id} value={item.id}>{item.category}／{item.name}</option>)}{editing && !incomeItems.some((item) => item.id === incomeId) && <option value={incomeId}>{records.find((record) => record.id === editing)?.name}（歷史版本）</option>}</select></label>
      <label>實收金額<input className="input" required type="number" min="1" max="2000000000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>收款日期<input className="input" required type="date" min={period?.starts_on} max={period?.ends_on} value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
      <label>內部備註<input className="input" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="budget-workbook__actions"><button className="btn btn-primary" disabled={saving}>{saving ? "儲存中…" : "儲存收款"}</button><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setOpen(false)}>取消</button></div>
    </form>}
    {records.length ? <ul className="finance-income__records">{records.map((record) => <li key={record.id}><span><strong>{record.category}／{record.name}</strong><small>{record.entry_date.replaceAll("-", "/")}{record.is_legacy && " · 原已登記收入"}{record.note && ` · ${record.note}`}</small></span><b>NT${record.amount.toLocaleString("zh-TW")}</b>{canRecord && !record.is_legacy && <button className="btn btn-secondary" type="button" disabled={saving} onClick={() => edit(record)}>編輯收款</button>}</li>)}</ul> : <p className="finance-simple__empty">尚未登記收款。</p>}
  </section>;
}
