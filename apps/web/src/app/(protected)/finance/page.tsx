"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  FilePlus2,
  ReceiptText,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useDraftAutosave, useFileDraftAutosave } from "@/hooks/useDraftAutosave";
import { usePermissions } from "@/hooks/usePermissions";
import { usePrompt } from "@/components/ui/ConfirmDialog";
import { financeApi, orgsApi, usersApi, type UserSummary } from "@/lib/api";
import AnimatedFileUpload from "@/components/ui/AnimatedFileUpload";
import BudgetWorkspace from "@/components/finance/BudgetWorkspace";
import type {
  ChartAccountOut,
  ExpenseProcurementStatus,
  ExpensePaymentStatus,
  FinanceExpenseClaimItemCreate,
  FinanceJournalOut,
  FundAccountOut,
  LedgerOut,
  OrgRead,
  PeriodOut,
} from "@/lib/types";

const storageLabel = { petty_cash: "零用金", safe: "保險箱", bank: "銀行帳戶" } as const;
const procurementStatusLabel: Record<ExpenseProcurementStatus, string> = {
  not_required: "不需請購",
  requested: "已送校商請購",
  ordered: "校商已下單",
  received: "已收貨",
};
const paymentStatusLabel: Record<ExpensePaymentStatus, string> = {
  unpaid: "尚未支付",
  school_paid: "校方已支付",
  dues_paid: "會費已支付",
  advance_reimbursed: "代墊已償還",
};
const claimStatusLabel: Record<string, string> = {
  pending_review: "待第二人確認",
  approved: "已確認／已過帳",
  returned: "已退回補正",
  rejected: "已拒絕",
  completed: "已完成",
};
const entryTypes = {
  opening: { label: "設定期初餘額", help: "將既有資金登錄為期初餘額，不是資金移轉。" },
  income: { label: "登錄收入", help: "記錄實際收款，例如活動報名費或補助款。" },
  expense: { label: "支出／報帳", help: "一張報帳可登錄多個購買品項，系統會自動計算總額。" },
} as const;
type EntryType = keyof typeof entryTypes;
type FinanceTab = "workspace" | "ledger" | "entry" | "funds" | "accounts" | "review" | "claims" | "budget";
type ManagedAccountType = "expense" | "revenue";

const managedAccountLabels: Record<ManagedAccountType, { title: string; singular: string }> = {
  expense: { title: "支出科目", singular: "支出" },
  revenue: { title: "收入科目", singular: "收入" },
};

const emptyClaimItem = (): FinanceExpenseClaimItemCreate => ({
  name: "",
  unit_price: 0,
  tax_rate: 0,
  quantity: 1,
  budget_exception_note: "尚未編列預算",
});
const today = new Date().toISOString().slice(0, 10);

type ExpenseClaimDraft = {
  periodId: string;
  fundId: string;
  expenseAccountId: string;
  entryDate: string;
  description: string;
  note: string;
  sourceUrl?: string;
  evidenceUrl?: string;
  items: FinanceExpenseClaimItemCreate[];
};

function claimItemTotal(item: FinanceExpenseClaimItemCreate): number {
  return Math.round(item.unit_price * (1 + (item.tax_rate || 0) / 100)) * item.quantity;
}

export default function FinancePage() {
  const { can } = usePermissions();
  const prompt = usePrompt();
  const canRecord = can("finance:record");
  const canClaimExpense = canRecord || can("finance:expense_claim");
  const canManage = can("finance:manage");
  const canReview = can("finance:review");
  const canProcurement = can("finance:procurement");
  const canSchoolPayment = can("finance:school_payment");
  const canDuesPayment = can("finance:dues_payment");
  const canBudget = can("finance:budget");
  const canBudgetPropose = canBudget || can("finance:budget_propose");
  const canBudgetReview = can("finance:budget_review");
  const [ledger, setLedger] = useState<LedgerOut | null>(null);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [orgId, setOrgId] = useState("");
  const [ledgerName, setLedgerName] = useState("班聯會財務帳本");
  const [accounts, setAccounts] = useState<ChartAccountOut[]>([]);
  const [funds, setFunds] = useState<FundAccountOut[]>([]);
  const [periods, setPeriods] = useState<PeriodOut[]>([]);
  const [journals, setJournals] = useState<FinanceJournalOut[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [activeTab, setActiveTab] = useState<FinanceTab>("workspace");
  const [isPeriodSetupOpen, setIsPeriodSetupOpen] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>("expense");
  const [fundId, setFundId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [entryDescription, setEntryDescription] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [claimOrgId, setClaimOrgId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"direct" | "advance">("direct");
  const [advanceQuery, setAdvanceQuery] = useState("");
  const [advanceCandidates, setAdvanceCandidates] = useState<UserSummary[]>([]);
  const [advancedById, setAdvancedById] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [itemEvidenceFiles, setItemEvidenceFiles] = useState<File[][]>([]);
  const [isEvidenceUploading, setIsEvidenceUploading] = useState(false);
  const [claimItems, setClaimItems] = useState<FinanceExpenseClaimItemCreate[]>([emptyClaimItem()]);
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

  useEffect(() => {
    void usersApi.me().then((user) => setAdvancedById(user.id)).catch(() => {});
  }, []);

  useEffect(() => {
    if (advanceQuery.trim().length < 2) return setAdvanceCandidates([]);
    void usersApi.listForSearch(advanceQuery.trim()).then(setAdvanceCandidates).catch(() => {});
  }, [advanceQuery]);

  useEffect(() => {
    setClaimOrgId((current) => current || orgs[0]?.id || "");
  }, [orgs]);

  useEffect(() => {
    setItemEvidenceFiles((files) => files.slice(0, claimItems.length));
  }, [claimItems.length]);

  const counterpartAccounts = useMemo(() => accounts.filter((account) => {
    if (!account.is_active) return false;
    if (entryType === "opening") return account.account_type === "equity";
    return account.account_type === (entryType === "income" ? "revenue" : "expense");
  }), [accounts, entryType]);
  const managedAccounts = accounts.filter((account) => account.account_type === managedAccountType);
  const expenseClaims = useMemo(
    () => journals.filter((item) => item.source_type === "expense_claim"),
    [journals],
  );
  const pendingReviewClaims = useMemo(
    () => journals.filter((item) => item.status === "pending_review"),
    [journals],
  );
  const procurementFollowUps = useMemo(
    () => expenseClaims.filter((item) => isApprovedClaim(item) && ["requested", "ordered"].includes(
      item.procurement_status || "not_required",
    )),
    [expenseClaims],
  );
  const paymentFollowUps = useMemo(
    () => expenseClaims.filter((item) => isApprovedClaim(item) && item.payment_status === "unpaid"),
    [expenseClaims],
  );
  const budgetFollowUps = useMemo(
    () => expenseClaims.filter((item) => isApprovedClaim(item) && item.budget_included === null),
    [expenseClaims],
  );
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
    setEvidenceUrl(draft.sourceUrl || draft.evidenceUrl || "");
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
    && !draft.sourceUrl
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
      sourceUrl: evidenceUrl,
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
      let finalEvidenceKey: string | undefined;
      if (evidenceFile) {
        setIsEvidenceUploading(true);
        finalEvidenceKey = (await financeApi.uploadEvidence(ledger.id, evidenceFile)).storage_key;
      }
      if (entryType === "expense") {
        if (!claimItems.every((item) => item.name.trim() && item.unit_price > 0 && item.quantity > 0)) {
          return toast.error("請完整填寫每個品項、單價與數量");
        }
        if (!claimOrgId) return toast.error("請選擇提出部門");
        if (paymentMethod === "advance" && !advancedById) return toast.error("請選擇代墊人");
        const itemEvidence = await Promise.all(itemEvidenceFiles.map((files) => Promise.all(files.map(async (file) => {
          const stored = await financeApi.uploadEvidence(ledger.id, file);
          return { ...stored, evidence_type: "receipt" as const };
        }))));
        await financeApi.createExpenseClaim(ledger.id, {
          period_id: periodId,
          entry_date: entryDate,
          fund_account_id: fund.id,
          expense_account_id: counterpart.id,
          description: entryDescription.trim(),
          items: claimItems.map((item, index) => ({ ...item, name: item.name.trim(), evidence: itemEvidence[index] || [] })),
          evidence_url: finalEvidenceKey,
          source_url: evidenceUrl.trim() || undefined,
          note: claimNote.trim() || undefined,
          proposing_org_id: claimOrgId,
          payment_method: paymentMethod,
          advanced_by_id: paymentMethod === "advance" ? advancedById : undefined,
        });
        setClaimItems([emptyClaimItem()]);
        setItemEvidenceFiles([]);
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
          evidence_url: finalEvidenceKey,
          source_url: evidenceUrl.trim() || undefined,
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

  const returnEntry = async (entryId: string) => {
    const note = await prompt({
      title: "退回報帳補正？",
      description: "退回原因會通知提出報帳的人員，並保留在稽核紀錄中。",
      inputLabel: "退回原因",
      required: true,
      confirmLabel: "退回報帳",
      danger: true,
    });
    if (!note?.trim()) return;
    try {
      await financeApi.returnClaim(entryId, note.trim());
      toast.success("報帳已退回補正");
      if (ledger) await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "退回報帳失敗");
    }
  };

  const updateProcurement = async (entryId: string, status: ExpenseProcurementStatus) => {
    try {
      await financeApi.updateProcurement(entryId, { status });
      toast.success("校商請購狀態已更新");
      if (ledger) await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新校商請購失敗");
    }
  };

  const markPayment = async (entryId: string, kind: "school" | "dues") => {
    try {
      if (kind === "school") await financeApi.markSchoolPaid(entryId);
      else await financeApi.markDuesPaid(entryId);
      toast.success(kind === "school" ? "已標記校方已支付" : "已標記會費已支付");
      if (ledger) await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新付款狀態失敗");
    }
  };

  const updateBudget = async (entryId: string, included: boolean) => {
    try {
      await financeApi.updateBudget(entryId, { included });
      toast.success(included ? "已列入預算" : "已取消預算列管");
      if (ledger) await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新預算狀態失敗");
    }
  };

  const updateClaimItem = (index: number, patch: Partial<FinanceExpenseClaimItemCreate>) => {
    setClaimItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const activePeriod = periods.find((period) => period.id === periodId && !period.is_closed);
  const availableEntryTypes = (Object.keys(entryTypes) as EntryType[]).filter((type) =>
    type === "expense" ? canClaimExpense : canRecord,
  );
  const roleQueues = [
    {
      id: "review" as const,
      count: pendingReviewClaims.length,
      title: "等待你覆核",
      description: "第二人確認後，案件才能進入付款、請購與預算列管。",
      visible: canReview,
      icon: ClipboardCheck,
    },
    {
      id: "claims" as const,
      count: procurementFollowUps.length,
      title: "等待請購追蹤",
      description: "校商已請購或下單的案件，請更新到收貨為止。",
      visible: canProcurement,
      icon: ReceiptText,
    },
    {
      id: "claims" as const,
      count: paymentFollowUps.length,
      title: "等待付款或償還",
      description: "已覆核的案件可登錄校方、會費付款或代墊償還。",
      visible: canSchoolPayment || canDuesPayment,
      icon: ShieldCheck,
    },
    {
      id: "claims" as const,
      count: budgetFollowUps.length,
      title: "等待預算列管",
      description: "已覆核案件請確認是否納入預算，以利後續稽核。",
      visible: canBudget,
      icon: Settings2,
    },
  ].filter((queue) => queue.visible);
  const availableCapabilities = [
    canClaimExpense && "提出支出／報帳",
    canReview && "第二人覆核",
    canProcurement && "追蹤校商請購",
    (canSchoolPayment || canDuesPayment) && "登錄付款或代墊償還",
    canBudget && "列管預算",
    canManage && "管理帳本設定",
  ].filter(Boolean) as string[];

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>班聯會財務總帳</p>
          <h1 className="text-2xl font-semibold">報帳與財務</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--text-muted)" }}>
            從送件到付款都在同一個案件裡追蹤；你能看到的案件與可執行的操作，由權限決定。
          </p>
        </div>
        {ledger && <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={changeLedger}>切換組織帳本</button>{canClaimExpense && <button className="btn btn-primary" onClick={() => { setEntryType("expense"); setActiveTab("entry"); }}><FilePlus2 size={16} aria-hidden="true" />送出報帳</button>}</div>}
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
          <nav className="finance-workspace-nav" aria-label="財務功能">
            <div className="finance-workspace-nav__primary">
              {([
                ["workspace", "工作台"],
                ["entry", "送出報帳"],
                ["review", "待我覆核"],
                ["claims", "所有案件"],
              ] as const).map(([tab, label]) => <button key={tab} className={`btn ${activeTab === tab ? "btn-primary" : "btn-secondary"}`} aria-pressed={activeTab === tab} onClick={() => { if (tab === "entry") setEntryType("expense"); setActiveTab(tab); }}>{label}</button>)}
            </div>
            <div className="finance-workspace-nav__secondary">
              <span>帳務設定</span>
              {([
                ["ledger", "帳本與期間"],
                ["funds", "資金保管"],
                ["accounts", "收支科目"],
                ["budget", "共同預算"],
              ] as const).map(([tab, label]) => <button key={tab} className={`finance-workspace-nav__link ${activeTab === tab ? "is-active" : ""}`} aria-current={activeTab === tab ? "page" : undefined} onClick={() => setActiveTab(tab)}>{label}</button>)}
            </div>
          </nav>

          {activeTab === "workspace" && <section className="finance-workspace">
            <div className="finance-workspace__intro">
              <div>
                <h2>先處理現在輪到你的事</h2>
                <p>一筆報帳會經過覆核、請購、付款與預算列管；各步驟可由不同權限的人處理，案件不會因為換手而失去脈絡。</p>
              </div>
              <button className="btn btn-primary" disabled={!canClaimExpense} onClick={() => { setEntryType("expense"); setActiveTab("entry"); }}><FilePlus2 size={16} aria-hidden="true" />{canClaimExpense ? "建立報帳" : "目前無報帳權限"}</button>
            </div>
            <div className="finance-workspace__flow" aria-label="報帳案件流程">
              {["送出報帳", "第二人覆核", "請購／付款", "預算列管", "完成追蹤"].map((step, index) => <div key={step} className="finance-workspace__flow-step"><span>{index + 1}</span><p>{step}</p></div>)}
            </div>
            <div className="finance-workspace__body">
              <section aria-labelledby="finance-queue-heading">
                <div className="finance-workspace__section-heading"><div><h3 id="finance-queue-heading">你的待辦</h3><p>只列出你目前有權限處理的工作。</p></div><span className="finance-workspace__count">{roleQueues.reduce((total, queue) => total + queue.count, 0)} 件</span></div>
                {roleQueues.length > 0 ? <div className="finance-workspace__queues">{roleQueues.map((queue) => { const Icon = queue.icon; return <button key={queue.title} className="finance-workspace__queue" onClick={() => setActiveTab(queue.id)}><Icon size={19} aria-hidden="true" /><span><strong>{queue.title}</strong><small>{queue.description}</small></span><b>{queue.count}</b><ArrowRight size={17} aria-hidden="true" /></button>; })}</div> : <div className="finance-workspace__empty"><Check size={18} aria-hidden="true" />目前沒有可處理的待辦。你仍可從「所有案件」查看已授權的資料。</div>}
              </section>
              <aside className="finance-workspace__permissions" aria-labelledby="finance-permissions-heading"><div><ShieldCheck size={19} aria-hidden="true" /><h3 id="finance-permissions-heading">你目前可處理</h3></div>{availableCapabilities.length > 0 ? <ul>{availableCapabilities.map((capability) => <li key={capability}><Check size={15} aria-hidden="true" />{capability}</li>)}</ul> : <p>目前只有查看權限。需要處理案件時，請由管理員指派對應財務權限。</p>}<button className="finance-workspace__text-action" onClick={() => setActiveTab("claims")}>查看所有已授權案件 <ArrowRight size={15} aria-hidden="true" /></button></aside>
            </div>
          </section>}

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
                {entryType === "expense" && <label className="text-sm">提出部門<select className="input mt-1" value={claimOrgId} onChange={(event) => setClaimOrgId(event.target.value)}><option value="">選擇部門</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
                {entryType === "expense" && <div className="text-sm"><span>付款方式</span><div className="mt-1 flex gap-2"><button type="button" className={`btn ${paymentMethod === "direct" ? "btn-primary" : "btn-secondary"}`} onClick={() => setPaymentMethod("direct")}>班聯直接付款</button><button type="button" className={`btn ${paymentMethod === "advance" ? "btn-primary" : "btn-secondary"}`} onClick={() => setPaymentMethod("advance")}>個人代墊</button></div></div>}
                {entryType === "expense" && paymentMethod === "advance" && <label className="text-sm md:col-span-2">代墊人搜尋<input className="input mt-1" value={advanceQuery} onChange={(event) => setAdvanceQuery(event.target.value)} placeholder="輸入姓名後選擇，預設為本人" />{advanceCandidates.length > 0 && <span className="mt-1 flex flex-wrap gap-2">{advanceCandidates.map((user) => <button type="button" className={`btn ${advancedById === user.id ? "btn-primary" : "btn-secondary"}`} key={user.id} onClick={() => { setAdvancedById(user.id); setAdvanceQuery(user.display_name); }}>{user.display_name}</button>)}</span>}</label>}
                <div className="text-sm md:col-span-2"><span>上傳憑證（選填）</span><AnimatedFileUpload accept="image/jpeg,image/png,image/webp,application/pdf" label="拖曳憑證到這裡" hint="支援 JPG、PNG、WebP 或 PDF，最大 20 MB；送出報帳時一併上傳" onFiles={(selected) => setEvidenceFile(selected[0] ?? null)} onRemove={() => setEvidenceFile(null)} />{evidenceFile && <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>已選擇：{evidenceFile.name}</span>}</div>
                <label className="text-sm md:col-span-2">外部憑證連結（選填）<input className="input mt-1" type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="若憑證已存放於雲端，可貼上連結" /></label>
              </div>
              {entryType === "expense" && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">品項</th><th className="px-3 py-2 text-right">未稅單價</th><th className="px-3 py-2 text-right">稅率（選填）</th><th className="px-3 py-2 text-right">數量</th><th className="px-3 py-2 text-right">含稅小計</th><th className="w-20 px-3 py-2" aria-label="移除品項" /></tr></thead><tbody>{claimItems.map((item, index) => <tr key={index} className="border-t" style={{ borderColor: "var(--border)" }}><td className="p-2"><input aria-label={`第 ${index + 1} 項品項`} className="input" value={item.name} onChange={(event) => updateClaimItem(index, { name: event.target.value })} placeholder="例如：原子筆" /></td><td className="p-2"><input aria-label={`第 ${index + 1} 項未稅單價`} className="input text-right" type="number" min="1" value={item.unit_price || ""} onChange={(event) => updateClaimItem(index, { unit_price: Number(event.target.value) })} /></td><td className="p-2"><input aria-label={`第 ${index + 1} 項稅率`} className="input text-right" type="number" min="0" max="100" value={item.tax_rate || ""} onChange={(event) => updateClaimItem(index, { tax_rate: Number(event.target.value) })} placeholder="0" /></td><td className="p-2"><input aria-label={`第 ${index + 1} 項數量`} className="input text-right" type="number" min="1" value={item.quantity || ""} onChange={(event) => updateClaimItem(index, { quantity: Number(event.target.value) })} /></td><td className="px-3 text-right tabular-nums">NT${claimItemTotal(item).toLocaleString()}</td><td className="p-2 text-center"><button className="btn btn-secondary" disabled={claimItems.length === 1} onClick={() => setClaimItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}>移除</button></td></tr>)}</tbody><tfoot><tr className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-3" colSpan={4}>合計</td><td className="px-3 py-3 text-right text-base font-semibold tabular-nums">NT${claimTotal.toLocaleString()}</td><td /></tr></tfoot></table><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button className="btn btn-secondary" onClick={() => setClaimItems((items) => [...items, emptyClaimItem()])}>新增品項</button>{expenseDraftSavedAt && <span className="text-xs" style={{ color: "var(--text-muted)" }}>草稿已自動暫存</span>}</div></div>}
              {entryType === "expense" && <div className="mt-4 grid gap-3 md:grid-cols-2">{claimItems.map((item, index) => <label key={`${item.name}-${index}`} className="text-sm">第 {index + 1} 項憑證（收據／發票／其他文件）<input className="input mt-1" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setItemEvidenceFiles((files) => { const next = [...files]; next[index] = Array.from(event.target.files || []); return next; })} />{itemEvidenceFiles[index]?.length ? <span className="mt-1 block text-xs" style={{ color: "var(--text-muted)" }}>已選擇 {itemEvidenceFiles[index].length} 份文件</span> : null}</label>)}</div>}
              {entryType === "expense" && <label className="mt-4 block text-sm">報帳備註（選填）<textarea className="input mt-1 min-h-24" value={claimNote} onChange={(event) => setClaimNote(event.target.value)} placeholder="例如：採購用途、核銷注意事項或其他內部說明" /></label>}
              <button className="btn btn-primary mt-4" disabled={isEvidenceUploading} onClick={() => void createEntry()}>{isEvidenceUploading ? "上傳憑證中…" : entryType === "expense" ? `送出報帳（NT$${claimTotal.toLocaleString()}）` : `${entryTypes[entryType].label}並送覆核`}</button>
            </section>
          ) : <section className="rounded border p-5 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>你目前只有查看權限。若要報帳，請指派「登錄支出／報帳」；登錄收入、期初與移轉則需要「登錄一般財務傳票」。</section>}
          </div>

          <section hidden={activeTab !== "funds"} className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold">資金保管點</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>餘額只計入已過帳傳票。請用收支／報帳登錄金額；只有在保管位置改變時才建立移轉。</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">{funds.map((fund) => <article key={fund.id} className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>{storageLabel[fund.storage_type]}</p><h3 className="font-semibold">{fund.name}</h3>{fund.storage_type === "bank" && <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{fund.bank_name || "未填銀行"}{fund.account_last_four ? `／末四碼 ${fund.account_last_four}` : ""}</p>}<p className="mt-2 text-xl font-semibold">NT${fund.balance.toLocaleString()}</p></article>)}</div>
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

          {activeTab === "review" && <section className="finance-case-list">
            <div className="finance-case-list__heading">
              <div><h2>待我覆核</h2><p>第二人確認是報帳案件進入付款、請購與預算列管的必要步驟。</p></div>
              <span className="finance-workspace__count">{pendingReviewClaims.length} 件</span>
            </div>
            {canReview ? pendingReviewClaims.length > 0 ? <div className="finance-case-list__items">{pendingReviewClaims.map((item) => <article key={item.id} className="finance-case-list__item">
              <div className="finance-case-list__summary"><div><p className="finance-case-list__meta">{item.entry_date} · {sourceLabel(item.source_type)}</p><h3>{item.description}</h3><p>{claimNextStep(item).detail}</p></div><div className="finance-case-list__actions"><button className="btn btn-primary" onClick={() => void reviewEntry(item.id)}>第二人確認</button>{item.source_type === "expense_claim" && <button className="btn btn-secondary" onClick={() => void returnEntry(item.id)}>退回補正</button>}</div></div>
            </article>)}</div> : <div className="finance-workspace__empty"><Check size={18} aria-hidden="true" />目前沒有待你覆核的傳票。</div> : <div className="finance-workspace__empty">你可查看待覆核案件；完成確認需要「第二人覆核」權限。</div>}
          </section>}

          {activeTab === "claims" && <section className="finance-case-list">
            <div className="finance-case-list__heading">
              <div><h2>所有案件</h2><p>只顯示你依目前權限可查閱的報帳案件。每一列都會說明下一步與負責角色。</p></div>
              <span className="finance-workspace__count">{expenseClaims.length} 件</span>
            </div>
            {expenseClaims.length > 0 ? <div className="finance-case-list__items">{expenseClaims.map((item) => {
              const next = claimNextStep(item);
              return <article key={item.id} className="finance-case-list__item finance-case-list__item--claim">
                <div className="finance-case-list__summary">
                  <div>
                    <p className="finance-case-list__meta">{item.entry_date} · {item.payment_method === "advance" ? "個人代墊" : "班聯直接付款"}</p>
                    <h3>{item.description}</h3>
                    <div className="finance-case-list__links">{item.evidence_url ? <a href={item.evidence_url} target="_blank" rel="noreferrer">查看憑證</a> : <span>未附憑證</span>}{item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">補充連結</a>}</div>
                  </div>
                  <div className="finance-case-list__next"><span>下一步</span><strong>{next.title}</strong><p>{next.detail}</p></div>
                </div>
                <ol className="finance-case-flow" aria-label={item.description + " 的報帳進度"}>
                  {claimFlowFor(item).map((step) => <li key={step.label} className={"finance-case-flow__step is-" + step.state}><span>{step.state === "done" ? <Check size={14} strokeWidth={3} aria-label="已完成" /> : step.order}</span><p>{step.label}</p><small>{step.detail}</small></li>)}
                </ol>
                <div className="finance-case-list__actions finance-case-list__actions--claim">
                  {item.claim_status === "pending_review" && (canReview ? <><button className="btn btn-primary" onClick={() => void reviewEntry(item.id)}>第二人確認</button><button className="btn btn-secondary" onClick={() => void returnEntry(item.id)}>退回補正</button></> : <span className="finance-case-list__owner">等待具有「第二人覆核」權限者</span>)}
                  {item.claim_status === "approved" && <>{canProcurement && <label className="finance-case-list__select">請購<select className="input" value={item.procurement_status || "not_required"} onChange={(event) => void updateProcurement(item.id, event.target.value as ExpenseProcurementStatus)}>{Object.entries(procurementStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}{item.payment_status === "unpaid" && <span className="flex flex-wrap gap-2">{canSchoolPayment && <button className="btn btn-secondary" onClick={() => void markPayment(item.id, "school")}>校方已付</button>}{canDuesPayment && <button className="btn btn-secondary" onClick={() => void markPayment(item.id, "dues")}>會費已付</button>}</span>}{canBudget && <button className="btn btn-secondary" onClick={() => void updateBudget(item.id, !item.budget_included)}>{item.budget_included ? "取消預算列管" : "列入預算"}</button>}</>}
                  {item.claim_status === "returned" && <span className="finance-case-list__owner">等待提出人補正後重新送出</span>}
                </div>
              </article>;
            })}</div> : <div className="finance-workspace__empty"><ReceiptText size={18} aria-hidden="true" />目前沒有你可查閱的報帳案件。</div>}
          </section>}

           {activeTab === "budget" && <BudgetWorkspace ledgerId={ledger.id} periods={periods} orgs={orgs} canManage={canBudget} canPropose={canBudgetPropose} canReview={canBudgetReview} />}
        </>
      )}
    </main>
  );
}

function sourceLabel(source: string | null) {
  return source === "fund_transfer" ? "資金移轉" : source === "expense_claim" ? "報帳" : "手動登錄";
}

type ClaimFlowState = "done" | "active" | "waiting" | "attention";

type ClaimFlowStep = {
  order: number;
  label: string;
  detail: string;
  state: ClaimFlowState;
};

function isApprovedClaim(entry: FinanceJournalOut): boolean {
  return entry.claim_status === "approved" || entry.claim_status === "completed";
}

function claimNextStep(entry: FinanceJournalOut): { title: string; detail: string } {
  if (entry.claim_status === "returned") {
    return { title: "等待補正", detail: "提出人補正後，案件會重新進入第二人覆核。" };
  }
  if (!isApprovedClaim(entry)) {
    return { title: "等待第二人覆核", detail: "具有「第二人覆核」權限的人員確認後才能繼續處理。" };
  }

  const pending: string[] = [];
  if (["requested", "ordered"].includes(entry.procurement_status || "not_required")) {
    pending.push("校商請購追蹤");
  }
  if ((entry.payment_status || "unpaid") === "unpaid") {
    pending.push(entry.payment_method === "advance" ? "償還個人代墊" : "登錄付款");
  }
  if (entry.budget_included === null) pending.push("確認預算列管");

  if (pending.length > 0) {
    return {
      title: pending[0],
      detail: pending.length > 1
        ? `${pending.join("、")}可由各自具備權限的人員分別處理。`
        : "請由具備對應財務權限的人員完成處理。",
    };
  }
  return { title: "流程已完成", detail: "覆核、付款與預算列管狀態已完整記錄，可隨時查閱。" };
}

function claimFlowFor(entry: FinanceJournalOut): ClaimFlowStep[] {
  const isReturned = entry.claim_status === "returned";
  const approved = isApprovedClaim(entry);
  const procurementStatus = entry.procurement_status || "not_required";
  const paymentStatus = entry.payment_status || "unpaid";

  return [
    {
      order: 1,
      label: "送件",
      detail: isReturned ? "等待補正" : "已送出",
      state: isReturned ? "attention" : "done",
    },
    {
      order: 2,
      label: "覆核",
      detail: isReturned ? "退回補正" : approved ? "已確認" : "待第二人確認",
      state: isReturned ? "attention" : approved ? "done" : "active",
    },
    {
      order: 3,
      label: "校商請購",
      detail: !approved ? "覆核後處理" : procurementStatus === "not_required" ? "不需請購" : procurementStatusLabel[procurementStatus],
      state: !approved ? "waiting" : procurementStatus === "requested" || procurementStatus === "ordered" ? "active" : "done",
    },
    {
      order: 4,
      label: entry.payment_method === "advance" ? "代墊償還" : "付款",
      detail: !approved ? "覆核後處理" : paymentStatusLabel[paymentStatus],
      state: !approved ? "waiting" : paymentStatus === "unpaid" ? "active" : "done",
    },
    {
      order: 5,
      label: "預算列管",
      detail: !approved ? "覆核後處理" : entry.budget_included === null ? "待確認" : entry.budget_included ? "已列入" : "不列入",
      state: !approved ? "waiting" : entry.budget_included === null ? "active" : "done",
    },
  ];
}
