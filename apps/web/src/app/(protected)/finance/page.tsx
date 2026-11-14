"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { financeApi, orgsApi } from "@/lib/api";
import BudgetWorkspace from "@/components/finance/BudgetWorkspace";
import type { LedgerOut, OrgRead, PeriodOut } from "@/lib/types";

export default function FinancePage() {
  const { can } = usePermissions();
  const canManage = can("finance:manage");
  const canBudget = can("finance:budget");
  const [ledgers, setLedgers] = useState<LedgerOut[]>([]);
  const [ledgerId, setLedgerId] = useState("");
  const [periods, setPeriods] = useState<PeriodOut[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [orgId, setOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [period, setPeriod] = useState({ name: "", starts_on: "", ends_on: "" });
  const loadOrgs = useCallback(async () => {
    try { setOrgs(await orgsApi.list({ active_only: true })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "無法載入組織，請重試"); }
  }, []);

  const loadLedgers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await financeApi.listLedgers();
      setLedgers(next);
      const storedId = localStorage.getItem("finance.ledger_id");
      setLedgerId((current) => next.find((item) => item.id === current || item.id === storedId)?.id || next[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "無法載入財務資料，請重試");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadLedgers(); }, [loadLedgers]);
  useEffect(() => {
    let cancelled = false;
    setPeriods([]);
    if (!ledgerId) return;
    localStorage.setItem("finance.ledger_id", ledgerId);
    void financeApi.listPeriods(ledgerId).then((next) => {
      if (!cancelled) { setPeriods(next); setSetupOpen(next.length === 0); }
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "無法載入會計期間");
    });
    return () => { cancelled = true; };
  }, [ledgerId]);
  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const createLedger = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId || saving) return;
    setSaving(true);
    setError("");
    try {
      const created = await financeApi.createLedger({ org_id: orgId, name: "班聯會預算" });
      await loadLedgers();
      setLedgerId(created.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "建立帳本失敗"); }
    finally { setSaving(false); }
  };
  const createPeriod = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ledgerId || saving) return;
    setSaving(true);
    setError("");
    try {
      await financeApi.createPeriod(ledgerId, period);
      setPeriods(await financeApi.listPeriods(ledgerId));
      setSetupOpen(false);
      setPeriod({ name: "", starts_on: "", ends_on: "" });
      toast.success("會計期間已建立");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "建立會計期間失敗"); }
    finally { setSaving(false); }
  };

  return <div className="finance-simple">
    <header className="finance-simple__heading">
      <h1>預算與收支</h1>
      <a className="btn btn-secondary" href="/public/budgets" target="_blank" rel="noreferrer">公開資料</a>
    </header>
    {error && <div className="finance-simple__error" role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => { void loadLedgers(); void loadOrgs(); }}>重新載入</button></div>}
    {loading ? <p role="status">正在載入預算…</p> : !ledgers.length ? (
      canManage ? <form className="finance-simple__setup" onSubmit={(event) => void createLedger(event)}>
        <h2>建立預算帳本</h2>
        <label>所屬組織<select className="input" required value={orgId} onChange={(event) => setOrgId(event.target.value)}><option value="">選擇組織</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
        <button className="btn btn-primary" disabled={saving}>{saving ? "建立中…" : "建立帳本"}</button>
      </form> : <p role="status">目前沒有可管理的預算。</p>
    ) : <>
      <div className="finance-simple__context">
        {ledgers.length > 1 && <label>帳本<select className="input" value={ledgerId} onChange={(event) => { setError(""); setLedgerId(event.target.value); }}>{ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}</option>)}</select></label>}
        {canManage && <button className="btn btn-secondary" aria-expanded={setupOpen} onClick={() => setSetupOpen((open) => !open)}>{setupOpen ? "收起期間設定" : "新增會計期間"}</button>}
      </div>
      {setupOpen && canManage && <form className="finance-simple__setup" onSubmit={(event) => void createPeriod(event)}>
        <h2>新增會計期間</h2>
        <label>期間名稱<input className="input" required maxLength={120} placeholder="例如：115 年度上學期" value={period.name} onChange={(event) => setPeriod({ ...period, name: event.target.value })} /></label>
        <label>開始日期<input className="input" type="date" required value={period.starts_on} onChange={(event) => setPeriod({ ...period, starts_on: event.target.value })} /></label>
        <label>結束日期<input className="input" type="date" required min={period.starts_on} value={period.ends_on} onChange={(event) => setPeriod({ ...period, ends_on: event.target.value })} /></label>
        <button className="btn btn-primary" disabled={saving}>{saving ? "建立中…" : "儲存期間"}</button>
      </form>}
      {ledgerId && <BudgetWorkspace key={ledgerId} ledgerId={ledgerId} periods={periods} orgs={orgs} canManage={canBudget} canPublish={canBudget || can("finance:budget_review")} canRecordExpense={can("finance:record") || can("finance:expense_claim") || canBudget} canRecordIncome={can("finance:record")} />}
    </>}
  </div>;
}
