"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDraftAutosave, useFileDraftAutosave } from "@/hooks/useDraftAutosave";
import { usePermissions } from "@/hooks/usePermissions";
import { financeApi, orgsApi } from "@/lib/api";
import type {
  ChartAccountOut,
  ExpenseClaimItemCreate,
  FundAccountOut,
  JournalOut,
  LedgerOut,
  OrgRead,
  PeriodOut,
} from "@/lib/types";

const storageLabel = { petty_cash: "零用金", safe: "保險箱", bank: "銀行帳戶" } as const;
const entryTypes = {
  opening: { label: "設定期初餘額", help: "將既有資金登錄為期初餘額，不是資金移轉。" },
  income: { label: "登錄收入", help: "記錄實際收款，例如活動報名費或補助款。" },
  expense: { label: "支出／報帳", help: "一張報帳可登錄多個購買品項，系統會自動計算總額。" },
} as const;
type EntryType = keyof typeof entryTypes;
type FinanceTab = "ledger" | "entry" | "funds" | "accounts" | "review";
type ManagedAccountType = "expense" | "revenue";

const managedAccountLabels: Record<ManagedAccountType, { title: string; singular: string }> = {
  expense: { title: "支出科目", singular: "支出" },
  revenue: { title: "收入科目", singular: "收入" },
};

const emptyClaimItem = (): ExpenseClaimItemCreate => ({
  name: "",
  unit_price: 0,
  tax_rate: 0,
  quantity: 1,
});
const today = new Date().toISOString().slice(0, 10);

type ExpenseClaimDraft = {
  periodId: string;
  fundId: string;
  expenseAccountId: string;
  entryDate: string;
  description: string;
  note: string;
  evidenceUrl: string;
  items: ExpenseClaimItemCreate[];
};

function claimItemTotal(item: ExpenseClaimItemCreate): number {
  return Math.round(item.unit_price * (1 + (item.tax_rate || 0) / 100)) * item.quantity;
}

export default function FinancePage() {
  const { can } = usePermissions();
  const canRecord = can("finance:record");
  const canClaimExpense = canRecord || can("finance:expense_claim");
  const canManage = can("finance:manage");
  const canReview = can("finance:review");
  const [ledger, setLedger] = useState<LedgerOut | null>(null);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [orgId, setOrgId] = useState("");
  const [ledgerName, setLedgerName] = useState("班聯會財務帳本");
  const [accounts, setAccounts] = useState<ChartAccountOut[]>([]);
  const [funds, setFunds] = useState<FundAccountOut[]>([]);
  const [periods, setPeriods] = useState<PeriodOut[]>([]);
  const [journals, setJournals] = useState<JournalOut[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [activeTab, setActiveTab] = useState<FinanceTab>("entry");
  const [isPeriodSetupOpen, setIsPeriodSetupOpen] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [fundId, setFundId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [entryDescription, setEntryDescription] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [isEvidenceUploading, setIsEvidenceUploading] = useState(false);
  const [claimItems, setClaimItems] = useState<ExpenseClaimItemCreate[]>([emptyClaimItem()]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [managedAccountType, setManagedAccountType] = useState<ManagedAccountType>("expense");
  const [newAccount, setNewAccount] = useState({ code: "", name: "" });
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editingAccountName, setEditingAccountName] = useState("");
  const [newPeriod, setNewPeriod] = useState({
    name: "",
    starts_on: `${new Date().getFullYear()}-01-01`,
    ends_on: `${new Date().getFullYear()}-12-31`,
  });

  const load = useCallback(async (id: string) => {
    try {
      const [info, nextAccounts, nextFunds, nextPeriods, nextJournals] = await Promise.all([
        financeApi.getLedger(id),
        financeApi.listAccounts(id),
        financeApi.listFunds(id),
        financeApi.listPeriods(id),
        financeApi.listJournals(id),
      ]);
      setLedger(info);
      setAccounts(nextAccounts);
      setFunds(nextFunds);
      setPeriods(nextPeriods);
      setJournals(nextJournals);
      setPeriodId((current) => current || nextPeriods.find((period) => !period.is_closed)?.id || "");
      setFundId((current) => current || nextFunds[0]?.id || "");
      setFromId((current) => current || nextFunds[0]?.id || "");
      setToId((current) => current || nextFunds[1]?.id || "");
      setIsPeriodSetupOpen(nextPeriods.length === 0);
      if (nextPeriods.length === 0) setActiveTab("ledger");
      localStorage.setItem("finance.ledger_id", id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入財務帳本失敗");
    }
  }, []);

  useEffect(() => {
    const id = localStorage.getItem("finance.ledger_id");
    if (id) void load(id);
  }, [load]);

  useEffect(() => {
    void orgsApi.list({ active_only: true }).then(setOrgs).catch((error) => {
      toast.error(error instanceof Error ? error.message : "無法載入組織清單");
    });
  }, []);

  const counterpartAccounts = useMemo(() => accounts.filter((account) => {
    if (!account.is_active) return false;
    if (entryType === "opening") return account.account_type === "equity";
    return account.account_type === (entryType === "income" ? "revenue" : "expense");
  }), [accounts, entryType]);
  const managedAccounts = accounts.filter((account) => account.account_type === managedAccountType);
  const claimTotal = claimItems.reduce(
    (total, item) => total + claimItemTotal(item),
    0,
  );

  useEffect(() => {
    setCounterAccountId((current) =>
      counterpartAccounts.some((account) => account.id === current)
        ? current
        : counterpartAccounts[0]?.id || "",
    );
  }, [counterpartAccounts]);

  const expenseDraftKey = ledger ? `finance:${ledger.id}:expense-claim` : "finance:expense-claim";
  const restoreExpenseDraft = useCallback((draft: ExpenseClaimDraft) => {
    setPeriodId(draft.periodId);
    setFundId(draft.fundId);
    setCounterAccountId(draft.expenseAccountId);
    setEntryDate(draft.entryDate);
    setEntryDescription(draft.description);
    setClaimNote(draft.note);
    setEvidenceUrl(draft.evidenceUrl);
    setClaimItems(
      draft.items.length > 0
        ? draft.items.map((item) => ({ ...item, tax_rate: item.tax_rate || 0 }))
        : [emptyClaimItem()],
    );
    toast.info("已復原未送出的報帳草稿");
  }, []);
  const isExpenseDraftEmpty = useCallback((draft: ExpenseClaimDraft) => (
    !draft.description
    && !draft.note
    && !draft.evidenceUrl
    && draft.items.every((item) => !item.name && !item.unit_price)
  ), []);
  const { clearDraft: clearExpenseDraft, lastSavedAt: expenseDraftSavedAt } = useDraftAutosave<ExpenseClaimDraft>({
    key: expenseDraftKey,
    enabled: Boolean(ledger) && entryType === "expense",
    value: {
      periodId,
      fundId,
      expenseAccountId: counterAccountId,
      entryDate,
      description: entryDescription,
      note: claimNote,
      evidenceUrl,
      items: claimItems,
    },
    onRestore: restoreExpenseDraft,
    isEmpty: isExpenseDraftEmpty,
  });
  const restoreEvidenceDraft = useCallback((files: File[]) => {
    setEvidenceFile(files[0] ?? null);
  }, []);
  const { clearDraftFiles: clearEvidenceDraft } = useFileDraftAutosave({
    key: `${expenseDraftKey}:evidence`,
    files: evidenceFile ? [evidenceFile] : [],
    enabled: Boolean(ledger) && entryType === "expense",
    onRestore: restoreEvidenceDraft,
  });

  const initialize = async () => {
    if (!orgId) return toast.error("請選擇要使用的組織");
    try {
      const created = await financeApi.createLedger({
        org_id: orgId,
        name: ledgerName.trim() || "班聯會財務帳本",
      });
      await load(created.id);
      toast.success("帳本已建立，請先新增會計期間，再登錄期初餘額或日常收支");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立帳本失敗");
    }
  };

  const addPeriod = async () => {
    if (!ledger || !newPeriod.name.trim()) return toast.error("請填寫會計期間名稱");
    try {
      await financeApi.createPeriod(ledger.id, newPeriod);
      setIsPeriodSetupOpen(false);
      toast.success("會計期間已建立");
      await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立會計期間失敗");
    }
  };

  const createEntry = async () => {
    const fund = funds.find((item) => item.id === fundId);
    const counterpart = accounts.find((item) => item.id === counterAccountId);
    if (!ledger || !periodId || !fund || !counterpart || !entryDescription.trim()) {
      return toast.error("請選擇期間、資金保管點與科目，並填寫摘要");
    }
    if (entryType === "expense" && !canClaimExpense) {
      return toast.error("你沒有登錄支出／報帳的權限");
    }
    if (entryType !== "expense" && !canRecord) {
      return toast.error("你沒有登錄期初餘額或收入的權限");
    }

    try {
      let finalEvidenceUrl = evidenceUrl.trim() || undefined;
      if (evidenceFile) {
        setIsEvidenceUploading(true);
        finalEvidenceUrl = (await financeApi.uploadEvidence(evidenceFile)).url;
      }
      if (entryType === "expense") {
        if (!claimItems.every((item) => item.name.trim() && item.unit_price > 0 && item.quantity > 0)) {
          return toast.error("請完整填寫每個品項、單價與數量");
        }
        await financeApi.createExpenseClaim(ledger.id, {
          period_id: periodId,
          entry_date: entryDate,
          fund_account_id: fund.id,
          expense_account_id: counterpart.id,
          description: entryDescription.trim(),
          items: claimItems.map((item) => ({ ...item, name: item.name.trim() })),
          evidence_url: finalEvidenceUrl,
          note: claimNote.trim() || undefined,
        });
        setClaimItems([emptyClaimItem()]);
        setClaimNote("");
        clearExpenseDraft();
        clearEvidenceDraft();
        toast.success("報帳已送覆核");
      } else {
        const amount = Number(entryAmount);
        if (!amount) return toast.error("請填寫金額");
        const fundLine = entryType === "opening"
          ? { account_id: fund.chart_account_id, debit: amount, credit: 0 }
          : { account_id: fund.chart_account_id, debit: amount, credit: 0 };
        const counterpartLine = entryType === "opening"
          ? { account_id: counterpart.id, debit: 0, credit: amount }
          : { account_id: counterpart.id, debit: 0, credit: amount };
        const prefix = entryType === "opening" ? "期初餘額" : "收入";
        const entry = await financeApi.createJournal(ledger.id, {
          period_id: periodId,
          entry_date: entryDate,
          description: `${prefix}｜${entryDescription.trim()}`,
          source_type: "manual_entry",
          source_event: entryType,
          evidence_url: finalEvidenceUrl,
          lines: [fundLine, counterpartLine],
        });
        await financeApi.submit(entry.id);
        setEntryAmount("");
        toast.success(`${entryTypes[entryType].label}已送覆核`);
      }
      setEntryDescription("");
      setEvidenceUrl("");
      setEvidenceFile(null);
      await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立傳票失敗");
    } finally {
      setIsEvidenceUploading(false);
    }
  };

  const transfer = async () => {
    const amount = Number(transferAmount);
    if (!ledger || !periodId || !fromId || !toId || !amount) {
      return toast.error("請選擇會計期間、轉出與轉入保管點，並填寫金額");
    }
    if (fromId === toId) return toast.error("轉出與轉入保管點不可相同");
    if (!canRecord) return toast.error("你沒有登錄資金移轉的權限");
    try {
      const entry = await financeApi.createTransfer(ledger.id, {
        period_id: periodId,
        entry_date: today,
        from_fund_account_id: fromId,
        to_fund_account_id: toId,
        amount,
        description: `${funds.find((fund) => fund.id === fromId)?.name} → ${funds.find((fund) => fund.id === toId)?.name}`,
      });
      await financeApi.submit(entry.id);
      setTransferAmount("");
      toast.success("資金移轉已送覆核");
      await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立移轉傳票失敗");
    }
  };

  const createAccount = async () => {
    if (!ledger || !newAccount.code.trim() || !newAccount.name.trim()) {
      return toast.error("請填寫科目代碼與名稱");
    }
    try {
      await financeApi.createAccount(ledger.id, {
        code: newAccount.code.trim(),
        name: newAccount.name.trim(),
        account_type: managedAccountType,
      });
      setNewAccount({ code: "", name: "" });
      toast.success(`${managedAccountLabels[managedAccountType].singular}科目已新增`);
      await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新增科目失敗");
    }
  };

  const saveAccount = async (account: ChartAccountOut) => {
    if (!ledger || !editingAccountName.trim()) return toast.error("請填寫科目名稱");
    try {
      await financeApi.updateAccount(ledger.id, account.id, { name: editingAccountName.trim() });
      setEditingAccountId(null);
      toast.success("科目已更新");
      await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新科目失敗");
    }
  };

  const changeLedger = () => {
    localStorage.removeItem("finance.ledger_id");
    setLedger(null);
    setAccounts([]);
    setFunds([]);
    setPeriods([]);
    setJournals([]);
    setPeriodId("");
  };

  const reviewEntry = async (entryId: string) => {
    try {
      await financeApi.post(entryId);
      toast.success("傳票已過帳");
      if (ledger) await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "覆核傳票失敗");
    }
  };

  const updateClaimItem = (index: number, patch: Partial<ExpenseClaimItemCreate>) => {
    setClaimItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const activePeriod = periods.find((period) => period.id === periodId && !period.is_closed);
  const availableEntryTypes = (Object.keys(entryTypes) as EntryType[]).filter((type) =>
    type === "expense" ? canClaimExpense : canRecord,
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>班聯會財務總帳</p>
          <h1 className="text-2xl font-semibold">財務帳本</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
            建立帳本與會計期間後，可登錄期初餘額、收入、支出與報帳；資金在保管點之間流動時才使用移轉。
          </p>
        </div>
        {ledger && <button className="btn btn-secondary" onClick={changeLedger}>切換組織帳本</button>}
      </header>

      {!ledger ? (
        <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
          <h2 className="font-semibold">先選擇要管理的組織</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>每個組織各有一套帳本與資金餘額；已建立的帳本會直接開啟。</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">組織<select className="input mt-1" value={orgId} onChange={(event) => setOrgId(event.target.value)}><option value="">請選擇組織</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.prefix ? `${org.prefix}｜` : ""}{org.name}</option>)}</select></label>
            <label className="text-sm">帳本名稱<input className="input mt-1" value={ledgerName} onChange={(event) => setLedgerName(event.target.value)} /></label>
          </div>
          <button className="btn btn-primary mt-4" disabled={!orgId} onClick={() => void initialize()}>開啟帳本</button>
        </section>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="財務功能">
            {([
              ["ledger", "班聯會財務帳本"],
              ["entry", "登錄收支與報帳"],
              ["funds", "資金保管點"],
              ["accounts", "收支科目"],
              ["review", "覆核"],
            ] as const).map(([tab, label]) => <button key={tab} className={`btn ${activeTab === tab ? "btn-primary" : "btn-secondary"}`} aria-pressed={activeTab === tab} onClick={() => setActiveTab(tab)}>{label}</button>)}
          </nav>

          <section hidden={activeTab !== "ledger"} className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div><h2 className="font-semibold">{ledger.name}</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>目前傳票使用的會計期間。</p></div>
              {activePeriod && <span className="text-sm" style={{ color: "var(--success)" }}>使用中：{activePeriod.name}</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <select className="input max-w-md" value={periodId} onChange={(event) => setPeriodId(event.target.value)}><option value="">請選擇使用中的會計期間</option>{periods.map((period) => <option key={period.id} value={period.id} disabled={period.is_closed}>{period.name}（{period.starts_on}～{period.ends_on}）{period.is_closed ? "／已關閉" : ""}</option>)}</select>
              {canManage && <button className="btn btn-secondary" onClick={() => setIsPeriodSetupOpen((open) => !open)}>{isPeriodSetupOpen ? "收合期間設定" : "新增會計期間"}</button>}
            </div>
            {(isPeriodSetupOpen || periods.length === 0) && canManage && <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-3"><input className="input" value={newPeriod.name} onChange={(event) => setNewPeriod({ ...newPeriod, name: event.target.value })} placeholder="期間名稱，例如 115 學年度上學期" /><input className="input" type="date" value={newPeriod.starts_on} onChange={(event) => setNewPeriod({ ...newPeriod, starts_on: event.target.value })} /><input className="input" type="date" value={newPeriod.ends_on} onChange={(event) => setNewPeriod({ ...newPeriod, ends_on: event.target.value })} /></div><button className="btn btn-primary mt-3" onClick={() => void addPeriod()}>儲存會計期間</button></div>}
          </section>

          <div hidden={activeTab !== "entry"}>
          {!activePeriod ? (
            <section className="rounded border p-5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>請先新增並選擇一個尚未關閉的會計期間，才能登錄傳票。</section>
          ) : availableEntryTypes.length > 0 ? (
            <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-3"><div><h2 className="font-semibold">登錄收支與報帳</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{entryTypes[entryType].help}</p></div><p className="text-sm" style={{ color: "var(--text-muted)" }}>送出後由另一位覆核人員過帳</p></div>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="傳票類型">{availableEntryTypes.map((type) => <button key={type} className={`btn ${entryType === type ? "btn-primary" : "btn-secondary"}`} aria-pressed={entryType === type} onClick={() => setEntryType(type)}>{entryTypes[type].label}</button>)}</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="text-sm">日期<input className="input mt-1" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
                <label className="text-sm">付款／收款保管點<select className="input mt-1" value={fundId} onChange={(event) => setFundId(event.target.value)}>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select></label>
                <label className="text-sm">{entryType === "opening" ? "對應科目" : entryType === "income" ? "收入科目" : "支出科目"}<select className="input mt-1" value={counterAccountId} onChange={(event) => setCounterAccountId(event.target.value)}>{counterpartAccounts.map((account) => <option key={account.id} value={account.id}>{account.code}｜{account.name}</option>)}</select></label>
                {entryType !== "expense" && <label className="text-sm">金額（NT$）<input className="input mt-1" type="number" min="1" value={entryAmount} onChange={(event) => setEntryAmount(event.target.value)} /></label>}
                <label className={`text-sm ${entryType === "expense" ? "xl:col-span-2" : ""}`}>摘要<input className="input mt-1" value={entryDescription} onChange={(event) => setEntryDescription(event.target.value)} placeholder={entryType === "expense" ? "例如：社團博覽會文具採購" : "請說明這筆款項"} /></label>
                <label className="text-sm md:col-span-2">上傳憑證（選填）<input className="input mt-1" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} />{evidenceFile && <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>已選擇：{evidenceFile.name}</span>}<span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>支援 JPG、PNG、WebP 或 PDF，最大 20 MB。</span></label>
                <label className="text-sm md:col-span-2">外部憑證連結（選填）<input className="input mt-1" type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="若憑證已存放於雲端，可貼上連結" /></label>
              </div>
              {entryType === "expense" && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">品項</th><th className="px-3 py-2 text-right">未稅單價</th><th className="px-3 py-2 text-right">稅率（選填）</th><th className="px-3 py-2 text-right">數量</th><th className="px-3 py-2 text-right">含稅小計</th><th className="w-20 px-3 py-2" aria-label="移除品項" /></tr></thead><tbody>{claimItems.map((item, index) => <tr key={index} className="border-t" style={{ borderColor: "var(--border)" }}><td className="p-2"><input aria-label={`第 ${index + 1} 項品項`} className="input" value={item.name} onChange={(event) => updateClaimItem(index, { name: event.target.value })} placeholder="例如：原子筆" /></td><td className="p-2"><input aria-label={`第 ${index + 1} 項未稅單價`} className="input text-right" type="number" min="1" value={item.unit_price || ""} onChange={(event) => updateClaimItem(index, { unit_price: Number(event.target.value) })} /></td><td className="p-2"><input aria-label={`第 ${index + 1} 項稅率`} className="input text-right" type="number" min="0" max="100" value={item.tax_rate || ""} onChange={(event) => updateClaimItem(index, { tax_rate: Number(event.target.value) })} placeholder="0" /></td><td className="p-2"><input aria-label={`第 ${index + 1} 項數量`} className="input text-right" type="number" min="1" value={item.quantity || ""} onChange={(event) => updateClaimItem(index, { quantity: Number(event.target.value) })} /></td><td className="px-3 text-right tabular-nums">NT${claimItemTotal(item).toLocaleString()}</td><td className="p-2 text-center"><button className="btn btn-secondary" disabled={claimItems.length === 1} onClick={() => setClaimItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}>移除</button></td></tr>)}</tbody><tfoot><tr className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-3" colSpan={4}>合計</td><td className="px-3 py-3 text-right text-base font-semibold tabular-nums">NT${claimTotal.toLocaleString()}</td><td /></tr></tfoot></table><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button className="btn btn-secondary" onClick={() => setClaimItems((items) => [...items, emptyClaimItem()])}>新增品項</button>{expenseDraftSavedAt && <span className="text-xs" style={{ color: "var(--text-muted)" }}>草稿已自動暫存</span>}</div></div>}
              {entryType === "expense" && <label className="mt-4 block text-sm">報帳備註（選填）<textarea className="input mt-1 min-h-24" value={claimNote} onChange={(event) => setClaimNote(event.target.value)} placeholder="例如：採購用途、核銷注意事項或其他內部說明" /></label>}
              <button className="btn btn-primary mt-4" disabled={isEvidenceUploading} onClick={() => void createEntry()}>{isEvidenceUploading ? "上傳憑證中…" : entryType === "expense" ? `送出報帳（NT$${claimTotal.toLocaleString()}）` : `${entryTypes[entryType].label}並送覆核`}</button>
            </section>
          ) : <section className="rounded border p-5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>你目前只有查看權限。若要報帳，請指派「登錄支出／報帳」；登錄收入、期初與移轉則需要「登錄一般財務傳票」。</section>}
          </div>

          <section hidden={activeTab !== "funds"} className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold">資金保管點</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>餘額只計入已過帳傳票。請用收支／報帳登錄金額；只有在保管位置改變時才建立移轉。</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">{funds.map((fund) => <article key={fund.id} className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>{storageLabel[fund.storage_type]}</p><h3 className="font-semibold">{fund.name}</h3><p className="mt-2 text-xl font-semibold">NT${fund.balance.toLocaleString()}</p></article>)}</div>
            {activePeriod && canRecord && <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--border)" }}><h3 className="font-medium">資金移轉</h3><div className="mt-3 grid gap-3 md:grid-cols-4"><select className="input" value={fromId} onChange={(event) => setFromId(event.target.value)}><option value="">轉出保管點</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><select className="input" value={toId} onChange={(event) => setToId(event.target.value)}><option value="">轉入保管點</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><input className="input" type="number" min="1" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="移轉金額（NT$）" /><button className="btn btn-secondary" onClick={() => void transfer()}>移轉並送覆核</button></div></div>}
          </section>

          {activeTab === "accounts" && (canManage ? (
            <section className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-semibold">收支科目</h2>
                  <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                    收入與支出分開管理；登錄收入及報帳時會依類型顯示可用科目。
                  </p>
                </div>
                <div className="flex gap-2" role="group" aria-label="科目類型">
                  {(Object.keys(managedAccountLabels) as ManagedAccountType[]).map((type) => (
                    <button
                      key={type}
                      className={`btn ${managedAccountType === type ? "btn-primary" : "btn-secondary"}`}
                      aria-pressed={managedAccountType === type}
                      onClick={() => {
                        setManagedAccountType(type);
                        setEditingAccountId(null);
                      }}
                    >
                      {managedAccountLabels[type].title}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
                <input
                  className="input"
                  value={newAccount.code}
                  onChange={(event) => setNewAccount({ ...newAccount, code: event.target.value })}
                  placeholder={`科目代碼，例如 ${managedAccountType === "expense" ? "5104" : "4104"}`}
                />
                <input
                  className="input"
                  value={newAccount.name}
                  onChange={(event) => setNewAccount({ ...newAccount, name: event.target.value })}
                  placeholder={`新增${managedAccountLabels[managedAccountType].singular}科目名稱`}
                />
                <button className="btn btn-secondary" onClick={() => void createAccount()}>新增科目</button>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead style={{ background: "var(--bg-elevated)" }}>
                    <tr><th className="px-3 py-2 text-left">代碼</th><th className="px-3 py-2 text-left">名稱</th><th className="px-3 py-2 text-left">狀態</th><th className="px-3 py-2 text-right">操作</th></tr>
                  </thead>
                  <tbody>
                    {managedAccounts.map((account) => (
                      <tr key={account.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-3 py-2">{account.code}</td>
                        <td className="px-3 py-2">{editingAccountId === account.id ? <input className="input" value={editingAccountName} onChange={(event) => setEditingAccountName(event.target.value)} /> : account.name}</td>
                        <td className="px-3 py-2">{account.is_active ? "使用中" : "已停用"}</td>
                        <td className="px-3 py-2 text-right">
                          {editingAccountId === account.id ? (
                            <span className="inline-flex gap-2"><button className="btn btn-primary" onClick={() => void saveAccount(account)}>儲存</button><button className="btn btn-secondary" onClick={() => setEditingAccountId(null)}>取消</button></span>
                          ) : <button className="btn btn-secondary" onClick={() => { setEditingAccountId(account.id); setEditingAccountName(account.name); }}>改名</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : <section className="rounded border p-5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>管理收支科目需要「管理財務設定」權限。</section>)}

          {activeTab === "review" && <section className="overflow-x-auto rounded border" style={{ borderColor: "var(--border)" }}><table className="w-full min-w-[720px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">日期</th><th className="px-3 py-2 text-left">摘要</th><th className="px-3 py-2 text-left">來源</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody>{journals.filter((item) => item.status === "pending_review").length > 0 ? journals.filter((item) => item.status === "pending_review").map((item) => <tr key={item.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{item.entry_date}</td><td className="px-3 py-2">{item.description}</td><td className="px-3 py-2">{sourceLabel(item.source_type)}</td><td className="px-3 py-2 text-right">{canReview ? <button className="btn btn-primary" onClick={() => void reviewEntry(item.id)}>覆核並過帳</button> : <span style={{ color: "var(--text-muted)" }}>需要覆核權限</span>}</td></tr>) : <tr><td className="px-3 py-6 text-center" colSpan={4} style={{ color: "var(--text-muted)" }}>目前沒有待覆核傳票。</td></tr>}</tbody></table></section>}
        </>
      )}
    </main>
  );
}

function sourceLabel(source: string | null) {
  return source === "fund_transfer" ? "資金移轉" : source === "expense_claim" ? "報帳" : "手動登錄";
}
