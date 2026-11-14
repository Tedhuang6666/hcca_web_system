"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import BudgetExpenseRegister from "./BudgetExpenseRegister";
import BudgetConsolidatedTable from "./BudgetConsolidatedTable";
import BudgetIncomeRegister from "./BudgetIncomeRegister";
import { financeApi } from "@/lib/api";
import type { FinanceBudget, FinanceBudgetDetail, FinanceBudgetIncomeItem, OrgRead, PeriodOut } from "@/lib/types";

type Props = {
  ledgerId: string;
  periods: PeriodOut[];
  orgs: OrgRead[];
  canManage: boolean;
  canPublish: boolean;
  canRecordExpense: boolean;
  canRecordIncome: boolean;
};

export default function BudgetWorkspace({ ledgerId, periods, orgs, canManage, canPublish, canRecordExpense, canRecordIncome }: Props) {
  const confirm = useConfirm();
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [detail, setDetail] = useState<FinanceBudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fullSnapshot, setFullSnapshot] = useState(true);
  const [importing, setImporting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [importResult, setImportResult] = useState<{ expenses: number; incomes: number; skipped: string[] } | null>(null);
  const [quickExpenseNodeId, setQuickExpenseNodeId] = useState<string | null>(null);
  const [quickIncome, setQuickIncome] = useState<FinanceBudgetIncomeItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFormRef = useRef<HTMLFormElement>(null);
  const requestId = useRef(0);
  const invalidateRequests = useCallback(() => { ++requestId.current; }, []);

  const load = useCallback(async (selectedId?: string) => {
    const request = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const next = await financeApi.listBudgets(ledgerId);
      const selected = next.find((budget) => budget.id === selectedId) || next[0];
      const nextDetail = selected ? await financeApi.getBudget(selected.id) : null;
      if (request !== requestId.current) return;
      setBudgets(next);
      setDetail(nextDetail);
      if (selected) setPeriodId(selected.period_id);
    } catch (cause) {
      if (request === requestId.current) {
        setDetail(null);
        setError(cause instanceof Error ? cause.message : "無法載入預算，請重試");
        throw cause;
      }
    } finally { if (request === requestId.current) setLoading(false); }
  }, [ledgerId]);
  useEffect(() => {
    void load().catch(() => undefined);
    return invalidateRequests;
  }, [load, invalidateRequests]);
  useEffect(() => {
    setPeriodId((current) => periods.some((period) => period.id === current && !period.is_closed)
      ? current : periods.find((period) => !period.is_closed)?.id || "");
  }, [periods]);

  const refreshDetail = async () => { await load(detail?.id); };
  const target = budgets.find((budget) => budget.period_id === periodId);
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !periodId || importing) return;
    if (file.size > 10 * 1024 * 1024) { setError("預算檔不可超過 10 MB"); return; }
    setImporting(true);
    setError("");
    setImportResult(null);
    try {
      const result = await financeApi.importBudget(ledgerId, {
        file, period_id: periodId, name: target?.name || file.name.replace(/\.xlsx$/i, "").slice(0, 160),
        budget_id: target?.id, full_snapshot: fullSnapshot,
      });
      setImportResult({ expenses: result.allocations_created, incomes: result.income_items_created, skipped: result.skipped_rows });
      setFile(null);
      uploadFormRef.current?.reset();
      if (fileRef.current) fileRef.current.value = "";
      await load(result.budget.id);
      toast.success("預算已更新並公開");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "上傳失敗，請重試"); }
    finally { setImporting(false); }
  };
  const togglePublication = async () => {
    if (!detail || publishing) return;
    const accepted = await confirm({
      title: detail.is_public ? "停止公開這份預算？" : "公開這份預算？",
      description: detail.is_public ? "公開頁與收據連結將無法繼續查閱。" : "預算、實際收支與支出收據將開放查閱。",
      confirmLabel: detail.is_public ? "停止公開" : "公開資料",
    });
    if (!accepted) return;
    setPublishing(true);
    setError("");
    try { await financeApi.updateBudgetPublication(detail.id, !detail.is_public); await refreshDetail(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "公開設定失敗"); }
    finally { setPublishing(false); }
  };
  const handleQuickExpense = useCallback(() => setQuickExpenseNodeId(null), []);
  const handleQuickIncome = useCallback(() => setQuickIncome(null), []);

  return <section className="finance-budget" aria-label="預算管理" aria-busy={loading || importing}>
    <div className="finance-budget__toolbar">
      {budgets.length > 0 && <label>目前預算<select className="input" disabled={loading || importing} value={detail?.id || ""} onChange={(event) => { setQuickExpenseNodeId(null); setQuickIncome(null); setImportResult(null); void load(event.target.value).catch(() => undefined); }}>{budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name}</option>)}</select></label>}
      {detail && <div className="finance-simple__publication"><span>{detail.is_public ? "已公開" : "未公開"}</span>{detail.is_public && <a className="btn btn-secondary" href={`/public/budgets/${detail.id}`} target="_blank" rel="noreferrer">查看公開頁</a>}{canPublish && <button className="btn btn-secondary" disabled={publishing || importing || loading} onClick={() => void togglePublication()}>{detail.is_public ? "停止公開" : "公開資料"}</button>}</div>}
    </div>
    {canManage && periods.some((period) => !period.is_closed) && <form ref={uploadFormRef} className="finance-simple__upload" onSubmit={(event) => void upload(event)}>
      <h2>上傳更新預算</h2>
      <label>會計期間<select className="input" required disabled={importing} value={periodId} onChange={(event) => setPeriodId(event.target.value)}><option value="">選擇期間</option>{periods.filter((period) => !period.is_closed).map((period) => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
      <label>Excel 預算檔<input ref={fileRef} className="input" type="file" required disabled={importing} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] || null); setImportResult(null); }} /></label>
      <label>更新方式<select className="input" disabled={importing} value={fullSnapshot ? "full" : "additions"} onChange={(event) => setFullSnapshot(event.target.value === "full")}><option value="full">完整總表：取代目前預算</option><option value="additions">僅新增項目：累加預算</option></select></label>
      <button className="btn btn-primary" disabled={loading || importing || !file || !periodId}>{importing ? "解析與更新中…" : "上傳並公開"}</button>
      {target && <p>更新「{target.name}」；已登記收支與收據會保留。</p>}
      {!fullSnapshot && <p>僅含新增項目的檔案才使用累加；重複上傳會再次計入。</p>}
    </form>}
    {error && <div className="finance-simple__error" role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => void load(detail?.id).catch(() => undefined)}>重新載入</button></div>}
    {importResult && <div className="finance-simple__import-result" role="status"><p>已更新 {importResult.expenses} 筆支出預算、{importResult.incomes} 筆收入預算。</p>{importResult.skipped.length > 0 && <details><summary>有 {importResult.skipped.length} 列未匯入</summary><ul>{importResult.skipped.map((row) => <li key={row}>{row}</li>)}</ul></details>}</div>}
    {loading && !detail ? <p role="status">正在載入預算…</p> : detail ? <div aria-busy={loading}>
      <BudgetConsolidatedTable detail={detail} canRecordIncome={canRecordIncome} canRecordExpense={canRecordExpense} onRegisterIncome={setQuickIncome} onRegisterExpense={setQuickExpenseNodeId} />
      <BudgetIncomeRegister key={`income-${detail.id}`} detail={detail} period={periods.find((period) => period.id === detail.period_id)} canRecord={canRecordIncome} quickIncome={quickIncome} onQuickRegistrationHandled={handleQuickIncome} onRecorded={refreshDetail} />
      <BudgetExpenseRegister key={`expense-${detail.id}`} budgetId={detail.id} ledgerId={ledgerId} allocations={detail.allocations} currentPlan={detail.current_plan} nodes={detail.nodes} expenses={detail.expenses} orgs={orgs} canRecord={canRecordExpense} quickNodeId={quickExpenseNodeId} onQuickRegistrationHandled={handleQuickExpense} isPublic={detail.is_public} onRecorded={refreshDetail} />
    </div> : !error && <p className="finance-simple__empty" role="status">{periods.length ? "尚未上傳預算。" : "建立會計期間後即可上傳預算。"}</p>}
  </section>;
}
