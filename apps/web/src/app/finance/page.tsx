"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { financeApi } from "@/lib/api";
import type { FundAccountOut, JournalOut } from "@/lib/types";

const storageLabel = { petty_cash: "零用金", safe: "保險箱", bank: "銀行帳戶" };

export default function FinancePage() {
  const [ledgerId, setLedgerId] = useState("");
  const [funds, setFunds] = useState<FundAccountOut[]>([]);
  const [journals, setJournals] = useState<JournalOut[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => setLedgerId(localStorage.getItem("finance.ledger_id") ?? ""), []);
  const load = async () => {
    if (!ledgerId) return;
    try {
      const [nextFunds, nextJournals] = await Promise.all([
        financeApi.listFunds(ledgerId), financeApi.listJournals(ledgerId),
      ]);
      setFunds(nextFunds); setJournals(nextJournals);
      localStorage.setItem("finance.ledger_id", ledgerId);
    } catch (error) { toast.error(error instanceof Error ? error.message : "載入財務帳失敗"); }
  };
  const transfer = async () => {
    if (!periodId || !fromId || !toId || !amount) { toast.error("請完整填寫會計期間、轉出、轉入與金額"); return; }
    try {
      await financeApi.createTransfer(ledgerId, { period_id: periodId, entry_date: new Date().toISOString().slice(0, 10), from_fund_account_id: fromId, to_fund_account_id: toId, amount: Number(amount), description: "資金保管點移轉" });
      toast.success("已建立待覆核轉帳傳票"); setAmount(""); await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "建立轉帳失敗"); }
  };
  return <main className="mx-auto max-w-7xl space-y-6 p-6">
    <header><p className="text-sm" style={{ color: "var(--text-muted)" }}>班聯會財務總帳</p><h1 className="text-2xl font-semibold">複式總帳與資金保管</h1><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>管理零用金、保險箱與銀行帳戶的正式會計分錄；班級／校商收款請前往另一個入口。</p></header>
    <section className="rounded border p-4" style={{ borderColor: "var(--border)" }}><label className="text-sm font-medium">帳本 ID</label><div className="mt-2 flex gap-2"><input className="input flex-1" value={ledgerId} onChange={(e) => setLedgerId(e.target.value)} placeholder="建立帳本後貼上 ID" /><button className="btn btn-primary" onClick={() => void load()}>載入帳本</button></div></section>
    <section className="grid gap-3 md:grid-cols-3">{funds.map((fund) => <article key={fund.id} className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>{storageLabel[fund.storage_type]}</p><h2 className="mt-1 font-semibold">{fund.name}</h2><p className="mt-3 text-2xl font-semibold">NT${fund.balance.toLocaleString()}</p>{fund.bank_name && <p className="mt-1 text-xs">{fund.bank_name} · ****{fund.account_last_four}</p>}</article>)}</section>
    <section className="rounded border p-4" style={{ borderColor: "var(--border)" }}><h2 className="font-semibold">資金移轉</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>例如：將零用金放入保險箱。送出後須由不同人覆核才會影響餘額。</p><div className="mt-4 grid gap-2 md:grid-cols-4"><input className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)} placeholder="會計期間 ID" /><select className="input" value={fromId} onChange={(e) => setFromId(e.target.value)}><option value="">轉出帳戶</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><select className="input" value={toId} onChange={(e) => setToId(e.target.value)}><option value="">轉入帳戶</option>{funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><input className="input" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="金額" /></div><button className="btn btn-primary mt-3" onClick={() => void transfer()}>建立轉帳傳票</button></section>
    <section className="overflow-x-auto rounded border" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[720px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">日期</th><th className="px-3 py-2 text-left">摘要</th><th className="px-3 py-2 text-left">狀態</th><th className="px-3 py-2 text-left">來源</th></tr></thead><tbody>{journals.map((item) => <tr key={item.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{item.entry_date}</td><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{item.status}</td><td className="px-3 py-2">{item.source_type ?? "手動登錄"}</td></tr>)}</tbody></table></section>
  </main>;
}
