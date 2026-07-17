"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
import type { FundAccountOut, JournalOut, LedgerOut, PeriodOut } from "@/lib/types";

const storageLabel = { petty_cash: "零用金", safe: "保險箱", bank: "銀行帳戶" } as const;
const today = new Date().toISOString().slice(0, 10);

export default function FinancePage() {
  const [ledger, setLedger] = useState<LedgerOut | null>(null);
  const [orgId, setOrgId] = useState("");
  const [ledgerName, setLedgerName] = useState("班聯會財務帳本");
  const [funds, setFunds] = useState<FundAccountOut[]>([]);
  const [periods, setPeriods] = useState<PeriodOut[]>([]);
  const [journals, setJournals] = useState<JournalOut[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [newPeriod, setNewPeriod] = useState({ name: "", starts_on: `${new Date().getFullYear()}-01-01`, ends_on: `${new Date().getFullYear()}-12-31` });

  const load = async (id = ledger?.id) => {
    if (!id) return;
    try {
      const [info, nextFunds, nextPeriods, nextJournals] = await Promise.all([
        financeApi.getLedger(id), financeApi.listFunds(id), financeApi.listPeriods(id), financeApi.listJournals(id),
      ]);
      setLedger(info); setFunds(nextFunds); setPeriods(nextPeriods); setJournals(nextJournals);
      setPeriodId((current) => current || nextPeriods.find((p) => !p.is_closed)?.id || "");
      localStorage.setItem("finance.ledger_id", id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "載入財務帳失敗"); }
  };

  useEffect(() => { const id = localStorage.getItem("finance.ledger_id"); if (id) void load(id); }, []);

  const initialize = async () => {
    if (!orgId.trim()) { toast.error("請填入組織 ID；可從組織管理頁複製"); return; }
    try { const created = await financeApi.createLedger({ org_id: orgId.trim(), name: ledgerName.trim() || "班聯會財務帳本" }); setLedger(created); await load(created.id); toast.success("帳本已建立，下一步請建立會計期間"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "建立帳本失敗"); }
  };

  const addPeriod = async () => {
    if (!ledger || !newPeriod.name.trim()) { toast.error("請填寫會計期間名稱"); return; }
    try { await financeApi.createPeriod(ledger.id, newPeriod); toast.success("會計期間已建立"); await load(ledger.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : "建立會計期間失敗"); }
  };

  const transfer = async () => {
    if (!ledger || !periodId || !fromId || !toId || !amount) { toast.error("請選擇會計期間、轉出帳戶、轉入帳戶並填寫金額"); return; }
    if (fromId === toId) { toast.error("轉出與轉入帳戶不可相同"); return; }
    try { await financeApi.createTransfer(ledger.id, { period_id: periodId, entry_date: today, from_fund_account_id: fromId, to_fund_account_id: toId, amount: Number(amount), description: `${funds.find((f) => f.id === fromId)?.name} → ${funds.find((f) => f.id === toId)?.name}` }); toast.success("已建立待覆核轉帳傳票"); setAmount(""); await load(ledger.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : "建立轉帳失敗"); }
  };

  return <main className="mx-auto max-w-7xl space-y-6 p-6">
    <header><p className="text-sm" style={{ color: "var(--text-muted)" }}>班聯會財務總帳</p><h1 className="text-2xl font-semibold">複式總帳與資金保管</h1><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>依照下方三個步驟設定。班級／校商收款請使用側邊欄的另一個入口。</p></header>

    {!ledger ? <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}><Step n="1" title="建立組織帳本" text="第一次使用時建立一次即可，之後系統會記住帳本。"><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">組織 ID<input className="input mt-1 w-full" value={orgId} onChange={(e) => setOrgId(e.target.value)} placeholder="從組織管理頁複製 UUID" /></label><label className="text-sm">帳本名稱<input className="input mt-1 w-full" value={ledgerName} onChange={(e) => setLedgerName(e.target.value)} /></label></div><button className="btn btn-primary mt-4" onClick={() => void initialize()}>建立帳本並繼續</button></Step></section> : <>
      <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}><Step n="1" title={ledger.name} text="帳本已設定完成。若要切換組織，可清除瀏覽器中的 finance.ledger_id 後重新建立。" /></section>
      <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}><Step n="2" title="建立會計期間" text="例如：2026 年度。所有傳票都必須落在未關閉的會計期間內。"><div className="grid gap-3 md:grid-cols-3"><input className="input" value={newPeriod.name} onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })} placeholder="期間名稱，例如 2026 年度" /><input className="input" type="date" value={newPeriod.starts_on} onChange={(e) => setNewPeriod({ ...newPeriod, starts_on: e.target.value })} /><input className="input" type="date" value={newPeriod.ends_on} onChange={(e) => setNewPeriod({ ...newPeriod, ends_on: e.target.value })} /></div><button className="btn btn-secondary mt-3" onClick={() => void addPeriod()}>新增會計期間</button>{periods.length > 0 && <select className="input mt-3 w-full" value={periodId} onChange={(e) => setPeriodId(e.target.value)}><option value="">請選擇使用中的會計期間</option>{periods.map((p) => <option key={p.id} value={p.id} disabled={p.is_closed}>{p.name}（{p.starts_on}～{p.ends_on}）{p.is_closed ? "／已關閉" : ""}</option>)}</select>}</Step></section>
      <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}><Step n="3" title="管理資金保管點" text="帳本初始化後會自動建立零用金、保險箱與銀行帳戶。資金移轉送出後須由另一位有覆核權限的人員過帳。"><div className="grid gap-3 md:grid-cols-3">{funds.map((fund) => <article key={fund.id} className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>{storageLabel[fund.storage_type]}</p><h3 className="font-semibold">{fund.name}</h3><p className="mt-2 text-xl font-semibold">NT${fund.balance.toLocaleString()}</p></article>)}</div><div className="mt-5 grid gap-3 md:grid-cols-4"><select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}><option value="">轉出哪裡？</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><select className="input" value={toId} onChange={(e) => setToId(e.target.value)}><option value="">轉入哪裡？</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><input className="input" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="移轉金額（NT$）" /><button className="btn btn-primary" onClick={() => void transfer()}>建立移轉傳票</button></div></Step></section>
      <section className="overflow-x-auto rounded border" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[720px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">日期</th><th className="px-3 py-2 text-left">摘要</th><th className="px-3 py-2 text-left">狀態</th><th className="px-3 py-2 text-left">來源</th></tr></thead><tbody>{journals.map((item) => <tr key={item.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{item.entry_date}</td><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{item.status === "pending_review" ? "待覆核" : item.status === "posted" ? "已過帳" : item.status}</td><td className="px-3 py-2">{item.source_type ?? "手動登錄"}</td></tr>)}</tbody></table></section>
    </>}
  </main>;
}

function Step({ n, title, text, children }: { n: string; title: string; text: string; children?: ReactNode }) {
  return <><div className="flex items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>{n}</span><div className="min-w-0 flex-1"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{text}</p>{children && <div className="mt-4">{children}</div>}</div></div></>;
}
