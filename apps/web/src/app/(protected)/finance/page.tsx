"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenText,
  Check,
  ClipboardCheck,
  FilePlus2,
  Landmark,
  LayoutDashboard,
  ListChecks,
  PiggyBank,
  ReceiptText,
  Settings2,
  ShieldCheck,
  WalletCards,
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
  FinanceExpenseClaimItemOut,
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
  draft: "草稿",
  pending_review: "待覆核確認",
  approved: "已確認／已過帳",
  posted: "已過帳",
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
type FinanceTab =
  | "workspace"
  | "ledger"
  | "entry"
  | "funds"
  | "accounts"
  | "review"
  | "claims"
  | "budget";
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
  unit: "項",
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
  return Math.round(
    Number(item.unit_price) * (1 + Number(item.tax_rate || 0) / 100) * Number(item.quantity),
  );
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
  const canCompleteClaim = canReview || canClaimExpense;
  const [ledger, setLedger] = useState<LedgerOut | null>(null);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [orgId, setOrgId] = useState("");
  const [ledgerName, setLedgerName] = useState("班聯會財務帳本");
  const [accounts, setAccounts] = useState<ChartAccountOut[]>([]);
  const [funds, setFunds] = useState<FundAccountOut[]>([]);
  const [periods, setPeriods] = useState<PeriodOut[]>([]);
  const [journals, setJournals] = useState<FinanceJournalOut[]>([]);
  const [isBooting, setIsBooting] = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");
  const [claimDetails, setClaimDetails] = useState<Record<string, FinanceExpenseClaimItemOut[]>>({});
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [loadingEntryDetails, setLoadingEntryDetails] = useState<string | null>(null);
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
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingManualEntryId, setEditingManualEntryId] = useState<string | null>(null);
  const [existingEvidenceKey, setExistingEvidenceKey] = useState<string | null>(null);
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
    if (id) void load(id).finally(() => setIsBooting(false));
    else setIsBooting(false);
  }, [load]);

  useEffect(() => {
    void orgsApi.list({ active_only: true }).then(setOrgs).catch((error) => {
      toast.error(error instanceof Error ? error.message : "無法載入組織清單");
    });
  }, []);

  useEffect(() => {
    void usersApi.me().then((user) => {
      setAdvancedById(user.id);
      setCurrentUserId(user.id);
    }).catch(() => {});
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
  const openingEntries = useMemo(
    () => journals.filter((item) => item.source_event === "opening"),
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
    if (entryType === "expense") {
      if (!claimItems.every((item) => (
        item.name.trim()
        && Number(item.unit_price) > 0
        && Number(item.quantity) > 0
        && item.unit?.trim()
      ))) {
        return toast.error("請完整填寫每個品項、單價、數量與單位");
      }
      if (!claimOrgId) return toast.error("請選擇提出部門");
      if (paymentMethod === "advance" && !advancedById) return toast.error("請選擇代墊人");
    } else if (!Number(entryAmount)) {
      return toast.error("請填寫金額");
    }

    try {
      setIsEvidenceUploading(true);
      let finalEvidenceKey = existingEvidenceKey || undefined;
      if (evidenceFile) {
        finalEvidenceKey = (await financeApi.uploadEvidence(ledger.id, evidenceFile)).storage_key;
      }
      if (entryType === "expense") {
        const itemEvidence = await Promise.all(itemEvidenceFiles.map((files) => Promise.all(files.map(async (file) => {
          const stored = await financeApi.uploadEvidence(ledger.id, file);
          return { ...stored, evidence_type: "receipt" as const };
        }))));
        const claimPayload = {
          period_id: periodId,
          entry_date: entryDate,
          fund_account_id: fund.id,
          expense_account_id: counterpart.id,
          description: entryDescription.trim(),
          items: claimItems.map((item, index) => ({
            ...item,
            name: item.name.trim(),
            evidence: [...(item.evidence || []), ...(itemEvidence[index] || [])],
          })),
          evidence_url: finalEvidenceKey,
          source_url: evidenceUrl.trim() || undefined,
          note: claimNote.trim() || undefined,
          proposing_org_id: claimOrgId,
          payment_method: paymentMethod,
          advanced_by_id: paymentMethod === "advance" ? advancedById : undefined,
        };
        if (editingEntryId) {
          await financeApi.updateExpenseClaim(editingEntryId, claimPayload);
        } else {
          await financeApi.createExpenseClaim(ledger.id, claimPayload);
        }
        setClaimItems([emptyClaimItem()]);
        setItemEvidenceFiles([]);
        setClaimNote("");
        setEditingEntryId(null);
        clearExpenseDraft();
        clearEvidenceDraft();
        toast.success(editingEntryId
          ? editingBudgetedClaim ? "核銷金額已更新，保留原核准與預算列管狀態" : "報帳已更新並送覆核"
          : "報帳已送覆核");
      } else {
        const amount = Number(entryAmount);
        const fundLine = entryType === "opening"
          ? { account_id: fund.chart_account_id, debit: amount, credit: 0 }
          : { account_id: fund.chart_account_id, debit: amount, credit: 0 };
        const counterpartLine = entryType === "opening"
          ? { account_id: counterpart.id, debit: 0, credit: amount }
          : { account_id: counterpart.id, debit: 0, credit: amount };
        const prefix = entryType === "opening" ? "期初餘額" : "收入";
        if (editingManualEntryId) {
          await financeApi.updateManualJournal(editingManualEntryId, {
            period_id: periodId,
            entry_date: entryDate,
            fund_account_id: fund.id,
            counterpart_account_id: counterpart.id,
            description: `${prefix}｜${entryDescription.trim()}`,
            amount,
            evidence_url: finalEvidenceKey,
            source_url: evidenceUrl.trim() || undefined,
          });
        } else {
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
        }
        setEntryAmount("");
        toast.success(editingManualEntryId
          ? "期初餘額已更新並送覆核；已過帳案件會另建留痕調整"
          : `${entryTypes[entryType].label}已送覆核`);
      }
      setEntryDescription("");
      setEvidenceUrl("");
      setEvidenceFile(null);
      setExistingEvidenceKey(null);
      setEditingManualEntryId(null);
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
    setClaimDetails({});
    setExpandedEntryId(null);
    setEditingEntryId(null);
    setEditingManualEntryId(null);
    setExistingEvidenceKey(null);
    setPeriodId("");
  };

  const loadClaimItems = async (entryId: string) => {
    const cached = claimDetails[entryId];
    if (cached) return cached;
    setLoadingEntryDetails(entryId);
    try {
      const items = await financeApi.listClaimItems(entryId);
      setClaimDetails((current) => ({ ...current, [entryId]: items }));
      return items;
    } finally {
      setLoadingEntryDetails((current) => current === entryId ? null : current);
    }
  };

  const toggleDetails = async (entryId: string) => {
    if (expandedEntryId === entryId) {
      setExpandedEntryId(null);
      return;
    }
    setExpandedEntryId(entryId);
    try {
      await loadClaimItems(entryId);
    } catch (error) {
      setExpandedEntryId(null);
      toast.error(error instanceof Error ? error.message : "載入案件詳情失敗");
    }
  };

  const editClaim = async (entry: FinanceJournalOut) => {
    if (!canEditExpenseClaim(entry, currentUserId)) {
      return toast.error("這筆報帳目前不可修改，或你不是提出人");
    }
    try {
      const items = await loadClaimItems(entry.id);
      const debitLine = entry.lines.find((line) => line.debit > 0);
      const creditLine = entry.lines.find((line) => line.credit > 0);
      const fund = funds.find((item) => item.chart_account_id === creditLine?.account_id)
        || (entry.payment_method === "advance" ? funds[0] : undefined);
      const expense = accounts.find((item) => item.id === debitLine?.account_id);
      if (!fund || !expense || items.length === 0) {
        return toast.error("案件明細不完整，暫時無法修改");
      }
      setEditingEntryId(entry.id);
      setEntryType("expense");
      setPeriodId(entry.period_id);
      setFundId(fund.id);
      setCounterAccountId(expense.id);
      setEntryDate(entry.entry_date);
      setEntryDescription(entry.description.replace(/^報帳｜/, "").replace(/（\d+ 項）$/, ""));
      setClaimNote(entry.note || "");
      setClaimOrgId(entry.proposing_org_id || orgs[0]?.id || "");
      setPaymentMethod(entry.payment_method || "direct");
      setAdvancedById(entry.advanced_by_id || currentUserId);
      setEvidenceUrl(entry.source_url || "");
      setExistingEvidenceKey(entry.evidence_url || null);
      setEvidenceFile(null);
      setItemEvidenceFiles(items.map(() => []));
      setClaimItems(items.map((item) => ({
        name: item.name,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        quantity: Number(item.quantity),
        unit: item.unit,
        budget_node_id: item.budget_node_id,
        budget_exception_note: item.budget_exception_note,
        evidence: item.evidence.map((evidence) => ({
          storage_key: evidence.storage_key,
          filename: evidence.filename,
          content_type: evidence.content_type,
          file_size: evidence.file_size,
          evidence_type: evidence.evidence_type,
          note: evidence.note,
        })),
      })));
      setActiveTab("entry");
      toast.info(isBudgetedClaimEditable(entry) ? "已載入報帳資料，可修改核銷金額" : "已載入報帳資料，可修改後重新送出");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入報帳資料失敗");
    }
  };

  const editOpeningBalance = (entry: FinanceJournalOut) => {
    const assetLine = entry.lines.find((line) => (
      line.debit > 0 && funds.some((fund) => fund.chart_account_id === line.account_id)
    ));
    const counterpartLine = entry.lines.find((line) => line.credit > 0);
    const fund = funds.find((item) => item.chart_account_id === assetLine?.account_id);
    const counterpart = accounts.find((item) => item.id === counterpartLine?.account_id);
    if (!assetLine || !fund || !counterpart) {
      toast.error("期初餘額的科目資料不完整，暫時無法修改");
      return;
    }
    const originalPeriod = periods.find((period) => period.id === entry.period_id);
    setEditingManualEntryId(entry.id);
    setEditingEntryId(null);
    setEntryType("opening");
    setPeriodId(
      originalPeriod && !originalPeriod.is_closed
        ? originalPeriod.id
        : periods.find((period) => !period.is_closed)?.id || "",
    );
    setFundId(fund.id);
    setCounterAccountId(counterpart.id);
    setEntryDate(entry.status === "posted" ? today : entry.entry_date);
    setEntryDescription(entry.description.replace(/^期初餘額(?:調整)?｜/, ""));
    setEntryAmount(String(entry.effective_amount ?? assetLine.debit));
    setEvidenceUrl(entry.source_url || "");
    setExistingEvidenceKey(entry.evidence_url || null);
    setEvidenceFile(null);
    setActiveTab("entry");
    toast.info(entry.status === "posted"
      ? "已載入目前期初餘額；儲存後會建立一筆待覆核調整，保留原始帳務。"
      : "已載入待覆核期初餘額，可直接修改後重新送審。");
  };

  const cancelClaimEdit = () => {
    setEditingEntryId(null);
    setExistingEvidenceKey(null);
    setActiveTab("claims");
  };

  const cancelManualEdit = () => {
    setEditingManualEntryId(null);
    setExistingEvidenceKey(null);
    setActiveTab("review");
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

  const completeClaim = async (entryId: string) => {
    try {
      await financeApi.completeClaim(entryId);
      toast.success("報帳已完成核銷，會納入期末決算");
      if (ledger) await load(ledger.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "完成核銷失敗");
    }
  };

  const updateClaimItem = (index: number, patch: Partial<FinanceExpenseClaimItemCreate>) => {
    setClaimItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const activePeriod = periods.find((period) => period.id === periodId && !period.is_closed);
  const availableEntryTypes = (Object.keys(entryTypes) as EntryType[]).filter((type) =>
    type === "expense" ? canClaimExpense : canRecord,
  );
  const entryTypeOptions = editingEntryId
    ? ["expense" as EntryType]
    : editingManualEntryId
      ? [entryType]
      : availableEntryTypes;
  const roleQueues = [
    {
      id: "review" as const,
      count: pendingReviewClaims.length,
      title: "等待你覆核",
      description: "覆核確認後，案件才能進入付款、請購與預算列管。",
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
    canReview && "覆核案件",
    canProcurement && "追蹤校商請購",
    (canSchoolPayment || canDuesPayment) && "登錄付款或代墊償還",
    canBudget && "列管預算",
    canManage && "管理帳本設定",
  ].filter(Boolean) as string[];
  const editingEntry = editingEntryId ? journals.find((item) => item.id === editingEntryId) : undefined;
  const editingBudgetedClaim = Boolean(editingEntry && isBudgetedClaimEditable(editingEntry));
  const totalFundBalance = funds.reduce((total, fund) => total + fund.balance, 0);
  const actionableCount = roleQueues.reduce((total, queue) => total + queue.count, 0);
  const recentClaims = expenseClaims.slice(0, 3);
  const expenseBasicsReady = Boolean(
    periodId && fundId && counterAccountId && entryDescription.trim() && claimOrgId,
  );
  const expenseItemsReady = claimItems.every((item) => (
    item.name.trim()
    && Number(item.unit_price) > 0
    && Number(item.quantity) > 0
    && item.unit?.trim()
  ));
  const expensePaymentReady = paymentMethod === "direct" || Boolean(advancedById);
  const expenseReady = expenseBasicsReady && expenseItemsReady && expensePaymentReady;
  const primaryNavigation = [
    { id: "workspace" as const, label: "工作台", icon: LayoutDashboard },
    { id: "entry" as const, label: "建立報帳", icon: FilePlus2 },
    { id: "review" as const, label: "待我覆核", icon: ClipboardCheck, count: pendingReviewClaims.length },
    { id: "claims" as const, label: "案件追蹤", icon: ListChecks },
    { id: "budget" as const, label: "共同預算", icon: PiggyBank },
  ];
  const settingsNavigation = [
    { id: "ledger" as const, label: "帳本與期間", icon: BookOpenText },
    { id: "funds" as const, label: "資金保管", icon: WalletCards },
    { id: "accounts" as const, label: "收支科目", icon: Settings2 },
  ];

  if (isBooting) {
    return (
      <main className="finance-page" aria-busy="true" aria-label="正在載入財務工作區">
        <div className="finance-loading" role="status">
          <span className="finance-loading__mark" aria-hidden="true" />
          <div>
            <strong>正在開啟財務工作區</strong>
            <p>同步帳本、會計期間與待辦案件…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="finance-page">
      <header className="finance-header">
        <div className="finance-header__copy">
          <h1>財務作業桌</h1>
          <p>報帳、覆核、付款與核銷共用同一條案件脈絡，現在輪到誰一眼就知道。</p>
        </div>
        {ledger && (
          <div className="finance-header__actions">
            <button className="btn btn-secondary" onClick={changeLedger}>切換組織帳本</button>
            {canClaimExpense && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEntryType("expense");
                  setActiveTab("entry");
                }}
              >
                <FilePlus2 size={16} aria-hidden="true" />建立報帳
              </button>
            )}
          </div>
        )}
      </header>

      {!ledger ? (
        <section className="finance-onboarding">
          <div className="finance-onboarding__guide">
            <Landmark size={24} aria-hidden="true" />
            <div>
              <h2>先開啟一套組織帳本</h2>
              <p>帳本會保存會計期間、資金位置、收支科目與每一筆報帳的完整處理紀錄。</p>
            </div>
          </div>
          <div className="finance-onboarding__form">
            <label>
              <span>管理組織</span>
              <select className="input" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
                <option value="">選擇組織</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.prefix ? `${org.prefix}｜` : ""}{org.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>帳本名稱</span>
              <input
                className="input"
                value={ledgerName}
                onChange={(event) => setLedgerName(event.target.value)}
              />
            </label>
            <button className="btn btn-primary" disabled={!orgId} onClick={() => void initialize()}>
              開啟財務工作區 <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </section>
      ) : (
        <div className="finance-module">
          <nav className="finance-workspace-nav" aria-label="財務作業導覽">
            <div className="finance-workspace-nav__context">
              <strong>{ledger.name}</strong>
              <span>{activePeriod?.name || "尚未選擇會計期間"}</span>
            </div>
            <div className="finance-workspace-nav__primary">
              {primaryNavigation.map(({ id, label, icon: Icon, count }) => (
                <button
                  key={id}
                  className={`finance-workspace-nav__link ${activeTab === id ? "is-active" : ""}`}
                  aria-current={activeTab === id ? "page" : undefined}
                  onClick={() => {
                    if (id === "entry") setEntryType("expense");
                    setActiveTab(id);
                  }}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                  {count ? <b>{count}</b> : null}
                </button>
              ))}
            </div>
            <div className="finance-workspace-nav__secondary">
              <span>帳務設定</span>
              {settingsNavigation.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`finance-workspace-nav__link ${activeTab === id ? "is-active" : ""}`}
                  aria-current={activeTab === id ? "page" : undefined}
                  onClick={() => setActiveTab(id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="finance-module__content">
          {activeTab === "workspace" && <section className="finance-workspace">
            <div className="finance-workspace__intro">
              <div>
                <span className="finance-workspace__status-dot" aria-hidden="true" />
                <div>
                  <h2>{actionableCount > 0 ? `有 ${actionableCount} 件工作等你處理` : "目前沒有急著處理的案件"}</h2>
                  <p>{activePeriod ? `${activePeriod.name}使用中。` : "尚未選擇會計期間。"} 每一步都會保留承辦與狀態紀錄。</p>
                </div>
              </div>
              <div className="finance-workspace__balance">
                <span>帳上資金</span>
                <strong>NT${totalFundBalance.toLocaleString()}</strong>
                <button onClick={() => setActiveTab("funds")}>查看 {funds.length} 個保管點</button>
              </div>
            </div>
            <div className="finance-workspace__flow" aria-label="報帳案件流程">
              {["提出報帳", "覆核確認", "預算列管", "請購／付款", "確認憑證", "完成核銷"].map((step, index) => <div key={step} className="finance-workspace__flow-step"><span>{index + 1}</span><p>{step}</p></div>)}
            </div>
            <div className="finance-workspace__body">
              <section aria-labelledby="finance-queue-heading">
                <div className="finance-workspace__section-heading"><div><h3 id="finance-queue-heading">你的處理佇列</h3><p>依你目前的權限，只顯示能由你接手的工作。</p></div><span className="finance-workspace__count">{actionableCount} 件</span></div>
                {roleQueues.length > 0 ? <div className="finance-workspace__queues">{roleQueues.map((queue) => { const Icon = queue.icon; return <button key={queue.title} className="finance-workspace__queue" onClick={() => setActiveTab(queue.id)}><Icon size={19} aria-hidden="true" /><span><strong>{queue.title}</strong><small>{queue.description}</small></span><b>{queue.count}</b><ArrowRight size={17} aria-hidden="true" /></button>; })}</div> : <div className="finance-workspace__empty"><Check size={18} aria-hidden="true" />目前沒有可處理的待辦。你仍可從「所有案件」查看已授權的資料。</div>}
              </section>
              <aside className="finance-workspace__side">
                <section className="finance-workspace__recent" aria-labelledby="finance-recent-heading">
                  <div><ReceiptText size={19} aria-hidden="true" /><h3 id="finance-recent-heading">最近案件</h3></div>
                  {recentClaims.length > 0 ? <ul>{recentClaims.map((claim) => <li key={claim.id}><button onClick={() => { setExpandedEntryId(claim.id); setActiveTab("claims"); }}><span>{claim.description}</span><small>{claimNextStep(claim).title}</small></button></li>)}</ul> : <p>還沒有報帳案件。建立第一筆後，處理進度會顯示在這裡。</p>}
                </section>
                <section className="finance-workspace__permissions" aria-labelledby="finance-permissions-heading"><div><ShieldCheck size={19} aria-hidden="true" /><h3 id="finance-permissions-heading">你的處理權限</h3></div>{availableCapabilities.length > 0 ? <ul>{availableCapabilities.map((capability) => <li key={capability}><Check size={15} aria-hidden="true" />{capability}</li>)}</ul> : <p>目前只有查看權限。需要處理案件時，請由管理員指派對應財務權限。</p>}<button className="finance-workspace__text-action" onClick={() => setActiveTab("claims")}>查看所有已授權案件 <ArrowRight size={15} aria-hidden="true" /></button></section>
              </aside>
            </div>
          </section>}

          <section hidden={activeTab !== "ledger"} className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div><h2 className="font-semibold">{ledger.name}</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>目前傳票使用的會計期間。</p></div>
              {activePeriod && <span className="text-sm" style={{ color: "var(--success)" }}>使用中：{activePeriod.name}</span>}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <select className="input max-w-md" aria-label="目前使用的會計期間" value={periodId} onChange={(event) => setPeriodId(event.target.value)}><option value="">請選擇使用中的會計期間</option>{periods.map((period) => <option key={period.id} value={period.id} disabled={period.is_closed}>{period.name}（{period.starts_on}～{period.ends_on}）{period.is_closed ? "／已關閉" : ""}</option>)}</select>
              {canManage && <button className="btn btn-secondary" onClick={() => setIsPeriodSetupOpen((open) => !open)}>{isPeriodSetupOpen ? "收合期間設定" : "新增會計期間"}</button>}
            </div>
            {(isPeriodSetupOpen || periods.length === 0) && canManage && <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-3"><label><span className="sr-only">期間名稱</span><input className="input" value={newPeriod.name} onChange={(event) => setNewPeriod({ ...newPeriod, name: event.target.value })} placeholder="期間名稱，例如 115 學年度上學期" /></label><label><span className="sr-only">期間開始日</span><input className="input" type="date" value={newPeriod.starts_on} onChange={(event) => setNewPeriod({ ...newPeriod, starts_on: event.target.value })} /></label><label><span className="sr-only">期間結束日</span><input className="input" type="date" value={newPeriod.ends_on} onChange={(event) => setNewPeriod({ ...newPeriod, ends_on: event.target.value })} /></label></div><button className="btn btn-primary mt-3" onClick={() => void addPeriod()}>儲存會計期間</button></div>}
          </section>

          <div hidden={activeTab !== "entry"}>
          {!activePeriod ? (
            <section className="finance-blocked-state">
              <BookOpenText size={22} aria-hidden="true" />
              <div>
                <h2>報帳前需要一個使用中的會計期間</h2>
                <p>先到「帳本與期間」新增或選擇尚未關閉的期間，再回來建立報帳。</p>
              </div>
              {canManage && <button className="btn btn-primary" onClick={() => setActiveTab("ledger")}>前往設定期間</button>}
            </section>
          ) : availableEntryTypes.length > 0 ? (
            <section className="finance-entry">
              <header className="finance-entry__header">
                <div>
                  <h2>{editingEntryId ? "修改報帳" : editingManualEntryId ? "修改期初餘額" : entryTypes[entryType].label}</h2>
                  <p>{editingBudgetedClaim ? "可調整已列入核准預算、尚未付款案件的核銷金額；儲存後保留原核准狀態。" : editingManualEntryId ? "待覆核資料會直接更新；已過帳資料會新增調整傳票，原紀錄不會被覆蓋。" : entryTypes[entryType].help}</p>
                </div>
                <div className="finance-entry__type-switch" role="group" aria-label="登錄類型">
                  {entryTypeOptions.map((type) => (
                    <button
                      key={type}
                      className={entryType === type ? "is-active" : ""}
                      aria-pressed={entryType === type}
                      onClick={() => setEntryType(type)}
                    >
                      {entryTypes[type].label}
                    </button>
                  ))}
                </div>
                {editingEntryId && <button className="btn btn-secondary" onClick={cancelClaimEdit}>取消修改</button>}
                {editingManualEntryId && <button className="btn btn-secondary" onClick={cancelManualEdit}>取消修改</button>}
              </header>

              <div className="finance-entry__layout">
                <div className="finance-entry__form">
                  <section className="finance-entry__section" aria-labelledby="finance-entry-basics">
                    <div className="finance-entry__section-heading">
                      <span>1</span>
                      <div><h3 id="finance-entry-basics">基本資料</h3><p>先說明這筆款項屬於哪個期間、科目與部門。</p></div>
                    </div>
                    <div className="finance-entry__fields">
                      <label>日期<input className="input" type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} disabled={editingBudgetedClaim} /></label>
                      <label>付款／收款保管點<select className="input" value={fundId} onChange={(event) => setFundId(event.target.value)} disabled={editingBudgetedClaim}>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select></label>
                      <label>{entryType === "opening" ? "對應科目" : entryType === "income" ? "收入科目" : "支出科目"}<select className="input" value={counterAccountId} onChange={(event) => setCounterAccountId(event.target.value)} disabled={editingBudgetedClaim}>{counterpartAccounts.map((account) => <option key={account.id} value={account.id}>{account.code}｜{account.name}</option>)}</select></label>
                      {entryType !== "expense" && <label>金額（NT$）<input className="input" type="number" min="1" value={entryAmount} onChange={(event) => setEntryAmount(event.target.value)} /></label>}
                      <label className="finance-entry__wide">摘要<input className="input" value={entryDescription} onChange={(event) => setEntryDescription(event.target.value)} placeholder={entryType === "expense" ? "例如：社團博覽會文具採購" : "請說明這筆款項"} /></label>
                      {entryType === "expense" && <label>提出部門<select className="input" value={claimOrgId} onChange={(event) => setClaimOrgId(event.target.value)}><option value="">選擇部門</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
                    </div>
                  </section>

                  {entryType === "expense" && <section className="finance-entry__section" aria-labelledby="finance-entry-items">
                    <div className="finance-entry__section-heading">
                      <span>2</span>
                      <div><h3 id="finance-entry-items">購買品項</h3><p>每一列都會獨立保留數量、稅額與憑證，方便後續核銷。</p></div>
                    </div>
                    <div className="finance-entry-items__table">
                      <table>
                        <thead><tr><th>品項</th><th>未稅單價</th><th>稅率</th><th>數量</th><th>單位</th><th>含稅小計</th><th aria-label="移除品項" /></tr></thead>
                        <tbody>{claimItems.map((item, index) => <tr key={index}><td><input aria-label={`第 ${index + 1} 項品項`} className="input" value={item.name} onChange={(event) => updateClaimItem(index, { name: event.target.value })} placeholder="例如：原子筆" /></td><td><input aria-label={`第 ${index + 1} 項未稅單價`} className="input" type="number" min="1" value={item.unit_price || ""} onChange={(event) => updateClaimItem(index, { unit_price: Number(event.target.value) })} /></td><td><input aria-label={`第 ${index + 1} 項稅率`} className="input" type="number" min="0" max="100" value={item.tax_rate || ""} onChange={(event) => updateClaimItem(index, { tax_rate: Number(event.target.value) })} placeholder="0" /></td><td><input aria-label={`第 ${index + 1} 項數量`} className="input" type="number" min="0.01" step="0.01" value={item.quantity || ""} onChange={(event) => updateClaimItem(index, { quantity: Number(event.target.value) })} /></td><td><input aria-label={`第 ${index + 1} 項單位`} className="input" value={item.unit || ""} onChange={(event) => updateClaimItem(index, { unit: event.target.value })} placeholder="項" /></td><td><strong>NT${claimItemTotal(item).toLocaleString()}</strong></td><td><button className="finance-entry__remove" disabled={claimItems.length === 1} onClick={() => setClaimItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}>移除</button></td></tr>)}</tbody>
                      </table>
                    </div>
                    <div className="finance-entry-items__mobile">
                      {claimItems.map((item, index) => <article key={index}>
                        <header><strong>品項 {index + 1}</strong><span>NT${claimItemTotal(item).toLocaleString()}</span></header>
                        <label>品項名稱<input className="input" value={item.name} onChange={(event) => updateClaimItem(index, { name: event.target.value })} placeholder="例如：原子筆" /></label>
                        <div><label>未稅單價<input className="input" type="number" min="1" value={item.unit_price || ""} onChange={(event) => updateClaimItem(index, { unit_price: Number(event.target.value) })} /></label><label>數量<input className="input" type="number" min="0.01" step="0.01" value={item.quantity || ""} onChange={(event) => updateClaimItem(index, { quantity: Number(event.target.value) })} /></label></div>
                        <div><label>單位<input className="input" value={item.unit || ""} onChange={(event) => updateClaimItem(index, { unit: event.target.value })} placeholder="項" /></label><label>稅率（%）<input className="input" type="number" min="0" max="100" value={item.tax_rate || ""} onChange={(event) => updateClaimItem(index, { tax_rate: Number(event.target.value) })} placeholder="0" /></label></div>
                        <button className="finance-entry__remove" disabled={claimItems.length === 1} onClick={() => setClaimItems((items) => items.filter((_, itemIndex) => itemIndex !== index))}>移除此品項</button>
                      </article>)}
                    </div>
                    <div className="finance-entry__section-footer"><button className="btn btn-secondary" onClick={() => setClaimItems((items) => [...items, emptyClaimItem()])}>新增一個品項</button>{expenseDraftSavedAt && <span>草稿已自動暫存</span>}</div>
                  </section>}

                  {entryType === "expense" && <section className="finance-entry__section" aria-labelledby="finance-entry-payment">
                    <div className="finance-entry__section-heading">
                      <span>3</span>
                      <div><h3 id="finance-entry-payment">付款安排</h3><p>選擇由班聯直接支付，或登記需要償還的個人代墊。</p></div>
                    </div>
                    <div className="finance-payment-options" role="group" aria-label="付款方式">
                      <button type="button" disabled={editingBudgetedClaim} className={paymentMethod === "direct" ? "is-active" : ""} aria-pressed={paymentMethod === "direct"} onClick={() => setPaymentMethod("direct")}><Landmark size={19} aria-hidden="true" /><span><strong>班聯直接付款</strong><small>由校方或會費帳戶支付</small></span><Check size={17} aria-hidden="true" /></button>
                      <button type="button" disabled={editingBudgetedClaim} className={paymentMethod === "advance" ? "is-active" : ""} aria-pressed={paymentMethod === "advance"} onClick={() => setPaymentMethod("advance")}><WalletCards size={19} aria-hidden="true" /><span><strong>個人代墊</strong><small>付款後追蹤代墊償還</small></span><Check size={17} aria-hidden="true" /></button>
                    </div>
                    {paymentMethod === "advance" && <label className="finance-entry__advance">代墊人<input className="input" value={advanceQuery} onChange={(event) => setAdvanceQuery(event.target.value)} placeholder="輸入姓名後選擇，預設為本人" />{advanceCandidates.length > 0 && <span>{advanceCandidates.map((user) => <button type="button" className={advancedById === user.id ? "is-active" : ""} key={user.id} onClick={() => { setAdvancedById(user.id); setAdvanceQuery(user.display_name); }}>{user.display_name}</button>)}</span>}</label>}
                  </section>}

                  <section className="finance-entry__section" aria-labelledby="finance-entry-evidence">
                    <div className="finance-entry__section-heading">
                      <span>{entryType === "expense" ? 4 : 2}</span>
                      <div><h3 id="finance-entry-evidence">憑證與說明</h3><p>現在可先附主要憑證，也可以送出後再依品項補齊。</p></div>
                    </div>
                    <div className="finance-entry__evidence-grid">
                      <div><span>整筆案件共用憑證（選填）</span><AnimatedFileUpload accept="image/jpeg,image/png,image/webp,application/pdf" label="拖曳憑證到這裡" hint="支援 JPG、PNG、WebP 或 PDF，最大 20 MB" onFiles={(selected) => setEvidenceFile(selected[0] ?? null)} onRemove={() => setEvidenceFile(null)} /></div>
                      <label>外部憑證連結（選填）<input className="input" type="url" value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="貼上雲端檔案或相關頁面連結" /></label>
                    </div>
                    {entryType === "expense" && <div className="finance-entry__item-evidence"><h4>逐項憑證（選填）</h4><div>{claimItems.map((item, index) => <label key={`${item.name}-${index}`}><span>品項 {index + 1}{item.name ? `｜${item.name}` : ""}</span><input className="input" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setItemEvidenceFiles((files) => { const next = [...files]; next[index] = Array.from(event.target.files || []); return next; })} />{itemEvidenceFiles[index]?.length ? <small>已選擇 {itemEvidenceFiles[index].length} 份文件</small> : null}</label>)}</div></div>}
                    {entryType === "expense" && <label className="finance-entry__note">報帳備註（選填）<textarea className="input" value={claimNote} onChange={(event) => setClaimNote(event.target.value)} placeholder="採購用途、核銷注意事項或給覆核者的說明" /></label>}
                  </section>
                </div>

                <aside className="finance-entry__summary" aria-label="送件摘要">
                  <span>{entryType === "expense" ? "本次報帳" : "本次登錄"}</span>
                  <strong>NT${(entryType === "expense" ? claimTotal : Number(entryAmount || 0)).toLocaleString()}</strong>
                  <dl>
                    <div><dt>會計期間</dt><dd>{activePeriod.name}</dd></div>
                    <div><dt>保管點</dt><dd>{funds.find((fund) => fund.id === fundId)?.name || "尚未選擇"}</dd></div>
                    <div><dt>送出後</dt><dd>{editingBudgetedClaim ? "保留核准狀態" : "進入覆核佇列"}</dd></div>
                  </dl>
                  {entryType === "expense" && <ul className="finance-entry__checklist">
                    <li className={expenseBasicsReady ? "is-ready" : ""}><Check size={14} aria-hidden="true" />基本資料完整</li>
                    <li className={expenseItemsReady ? "is-ready" : ""}><Check size={14} aria-hidden="true" />品項與金額完整</li>
                    <li className={expensePaymentReady ? "is-ready" : ""}><Check size={14} aria-hidden="true" />付款方式已確認</li>
                  </ul>}
                  <button className="btn btn-primary" disabled={isEvidenceUploading || (entryType === "expense" && !expenseReady)} onClick={() => void createEntry()}>{isEvidenceUploading ? "正在處理憑證…" : entryType === "expense" ? (editingEntryId ? "儲存報帳" : "送出報帳") : editingManualEntryId ? "儲存並送覆核" : `${entryTypes[entryType].label}並送覆核`}</button>
                  <p>{editingEntryId ? (editingBudgetedClaim ? "修正後不需重新覆核。" : "修改後會重新進入覆核。") : editingManualEntryId ? "系統會保留修改人與調整紀錄。" : "送出前可隨時離開，草稿會保留在這台裝置。"}</p>
                </aside>
              </div>
            </section>
          ) : <section className="finance-blocked-state"><ShieldCheck size={22} aria-hidden="true" /><div><h2>目前只有查看權限</h2><p>建立報帳需要「登錄支出／報帳」權限；登錄收入、期初與移轉則需要「登錄一般財務傳票」。</p></div></section>}
          </div>

          <section hidden={activeTab !== "funds"} className="rounded border p-5" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold">資金保管點</h2><p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>餘額只計入已過帳傳票。請用收支／報帳登錄金額；只有在保管位置改變時才建立移轉。</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">{funds.map((fund) => <article key={fund.id} className="rounded border p-4" style={{ borderColor: "var(--border)" }}><p className="text-sm" style={{ color: "var(--text-muted)" }}>{storageLabel[fund.storage_type]}</p><h3 className="font-semibold">{fund.name}</h3>{fund.storage_type === "bank" && <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{fund.bank_name || "未填銀行"}{fund.account_last_four ? `／末四碼 ${fund.account_last_four}` : ""}</p>}<p className="mt-2 text-xl font-semibold">NT${fund.balance.toLocaleString()}</p></article>)}</div>
            {openingEntries.length > 0 && <div className="finance-opening-list"><div><h3>期初餘額紀錄</h3><p>待覆核資料可直接修改；已過帳資料會以調整傳票留存異動。</p></div>{openingEntries.map((entry) => <article key={entry.id}><span><small>{entry.reference_no}</small><strong>{entry.description}</strong></span><b>NT${(entry.effective_amount ?? entry.lines.reduce((sum, line) => sum + line.debit, 0)).toLocaleString()}</b><em>{claimStatusLabel[entry.status] || entry.status}</em>{canRecord && <button className="btn btn-secondary" onClick={() => editOpeningBalance(entry)}>修改期初餘額</button>}</article>)}</div>}
            {activePeriod && canRecord && <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--border)" }}><h3 className="font-medium">資金移轉</h3><div className="mt-3 grid gap-3 md:grid-cols-4"><select className="input" aria-label="轉出保管點" value={fromId} onChange={(event) => setFromId(event.target.value)}><option value="">轉出保管點</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><select className="input" aria-label="轉入保管點" value={toId} onChange={(event) => setToId(event.target.value)}><option value="">轉入保管點</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><input className="input" aria-label="移轉金額（新臺幣）" type="number" min="1" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} placeholder="移轉金額（NT$）" /><button className="btn btn-secondary" onClick={() => void transfer()}>移轉並送覆核</button></div></div>}
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
                  aria-label={`新增${managedAccountLabels[managedAccountType].singular}科目代碼`}
                  value={newAccount.code}
                  onChange={(event) => setNewAccount({ ...newAccount, code: event.target.value })}
                  placeholder={`科目代碼，例如 ${managedAccountType === "expense" ? "5104" : "4104"}`}
                />
                <input
                  className="input"
                  aria-label={`新增${managedAccountLabels[managedAccountType].singular}科目名稱`}
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
                        <td className="px-3 py-2">{editingAccountId === account.id ? <input className="input" aria-label={`修改科目 ${account.code} 名稱`} value={editingAccountName} onChange={(event) => setEditingAccountName(event.target.value)} /> : account.name}</td>
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
              <div><h2>待我覆核</h2><p>具覆核權限的人員確認後，報帳案件才能進入付款、請購與預算列管。</p></div>
              <span className="finance-workspace__count">{pendingReviewClaims.length} 件</span>
            </div>
            {canReview ? pendingReviewClaims.length > 0 ? <div className="finance-case-list__items">{pendingReviewClaims.map((item) => {
              const ownClaim = item.source_type === "expense_claim" && item.created_by_id === currentUserId;
              return <article key={item.id} className="finance-case-list__item">
                <div className="finance-case-list__summary"><div><p className="finance-case-list__meta">{item.entry_date} · {sourceLabel(item.source_type, item.source_event)}</p><h3>{item.description}</h3><p>{claimNextStep(item).detail}</p></div><div className="finance-case-list__actions"><button className="btn btn-secondary" onClick={() => void toggleDetails(item.id)}>{expandedEntryId === item.id ? "收起詳情" : "查看詳情"}</button>{item.source_event === "opening" && canRecord && <button className="btn btn-secondary" onClick={() => editOpeningBalance(item)}>修改期初餘額</button>}{ownClaim && canClaimExpense && canEditExpenseClaim(item, currentUserId) && <button className="btn btn-primary" onClick={() => void editClaim(item)}>修改報帳</button>}{canReview ? <><button className="btn btn-primary" onClick={() => void reviewEntry(item.id)}>確認並過帳</button>{item.source_type === "expense_claim" && <button className="btn btn-secondary" onClick={() => void returnEntry(item.id)}>退回補正</button>}</> : ownClaim && <span className="finance-case-list__owner">需要「覆核案件」權限才能處理</span>}</div></div>
                {expandedEntryId === item.id && <FinanceCaseDetails entry={item} items={claimDetails[item.id]} loading={loadingEntryDetails === item.id} />}
              </article>;
            })}</div> : <div className="finance-workspace__empty"><Check size={18} aria-hidden="true" />目前沒有待你覆核的傳票。</div> : <div className="finance-workspace__empty">你可查看待覆核案件；完成確認需要「覆核案件」權限。</div>}
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
                  <button className="btn btn-secondary" onClick={() => void toggleDetails(item.id)}>{expandedEntryId === item.id ? "收起詳情" : "查看詳情"}</button>
                  {canClaimExpense && canEditExpenseClaim(item, currentUserId) && <button className="btn btn-secondary" onClick={() => void editClaim(item)}>{isBudgetedClaimEditable(item) ? "修改核銷金額" : "修改報帳"}</button>}
                  {item.claim_status === "pending_review" && (canReview ? <><button className="btn btn-primary" onClick={() => void reviewEntry(item.id)}>確認並過帳</button><button className="btn btn-secondary" onClick={() => void returnEntry(item.id)}>退回補正</button></> : <span className="finance-case-list__owner">等待具有「覆核案件」權限者</span>)}
                  {item.claim_status === "approved" && <>{!item.budget_included ? (canBudget ? <button className="btn btn-primary" onClick={() => void updateBudget(item.id, true)}>列入已核准預算</button> : <span className="finance-case-list__owner">等待具有「管理預算」權限者列管</span>) : <>{canProcurement && <label className="finance-case-list__select">請購<select className="input" value={item.procurement_status || "not_required"} onChange={(event) => void updateProcurement(item.id, event.target.value as ExpenseProcurementStatus)}>{Object.entries(procurementStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}{item.payment_status === "unpaid" && <span className="flex flex-wrap gap-2">{canSchoolPayment && <button className="btn btn-secondary" onClick={() => void markPayment(item.id, "school")}>校方已付</button>}{canDuesPayment && <button className="btn btn-secondary" onClick={() => void markPayment(item.id, "dues")}>會費已付</button>}</span>}{item.payment_status !== "unpaid" && !item.evidence_complete && <span className="finance-case-list__owner">請先上傳憑證，再完成核銷</span>}{item.payment_status !== "unpaid" && item.evidence_complete && canCompleteClaim && <button className="btn btn-primary" onClick={() => void completeClaim(item.id)}>完成核銷</button>}</>}</>}
                  {item.claim_status === "returned" && <span className="finance-case-list__owner">等待提出人補正後重新送出</span>}
                </div>
                {expandedEntryId === item.id && <FinanceCaseDetails entry={item} items={claimDetails[item.id]} loading={loadingEntryDetails === item.id} />}
              </article>;
            })}</div> : <div className="finance-workspace__empty"><ReceiptText size={18} aria-hidden="true" />目前沒有你可查閱的報帳案件。</div>}
          </section>}

           {activeTab === "budget" && <BudgetWorkspace ledgerId={ledger.id} periods={periods} orgs={orgs} canManage={canBudget} canPropose={canBudgetPropose} canReview={canBudgetReview} canPublish={canBudget || canBudgetReview} currentUserId={currentUserId} />}
          </div>
        </div>
      )}
    </main>
  );
}

function FinanceCaseDetails({
  entry,
  items,
  loading,
}: {
  entry: FinanceJournalOut;
  items?: FinanceExpenseClaimItemOut[];
  loading: boolean;
}) {
  return (
    <div className="mt-4 border-t pt-4 text-sm" style={{ borderColor: "var(--border)" }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><span style={{ color: "var(--text-muted)" }}>案件編號</span><p>{entry.reference_no}</p></div>
        <div><span style={{ color: "var(--text-muted)" }}>狀態</span><p>{claimStatusLabel[entry.claim_status || entry.status] || entry.status}</p></div>
        <div><span style={{ color: "var(--text-muted)" }}>提出人</span><p>{entry.created_by_name}</p></div>
        <div><span style={{ color: "var(--text-muted)" }}>備註</span><p>{entry.note || "—"}</p></div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">會計科目</th><th className="px-3 py-2 text-right">借方</th><th className="px-3 py-2 text-right">貸方</th><th className="px-3 py-2 text-left">備註</th></tr></thead>
          <tbody>{entry.lines.map((line) => <tr key={line.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{line.account_name || line.account_id}</td><td className="px-3 py-2 text-right tabular-nums">{line.debit ? `NT$${line.debit.toLocaleString()}` : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{line.credit ? `NT$${line.credit.toLocaleString()}` : "—"}</td><td className="px-3 py-2">{line.memo || "—"}</td></tr>)}</tbody>
        </table>
      </div>
      {entry.source_type === "expense_claim" && <div className="mt-4">
        <h4 className="font-medium">報帳品項</h4>
        {loading ? <p className="mt-2" style={{ color: "var(--text-muted)" }}>載入品項中…</p> : items && items.length > 0 ? <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead style={{ background: "var(--bg-elevated)" }}><tr><th className="px-3 py-2 text-left">品項</th><th className="px-3 py-2 text-right">數量</th><th className="px-3 py-2 text-right">單價</th><th className="px-3 py-2 text-right">含稅小計</th><th className="px-3 py-2 text-left">憑證</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2">{item.name}<span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>{item.budget_exception_note || ""}</span></td><td className="px-3 py-2 text-right tabular-nums">{item.quantity} {item.unit}</td><td className="px-3 py-2 text-right tabular-nums">NT${item.unit_price.toLocaleString()}</td><td className="px-3 py-2 text-right tabular-nums">NT${claimItemTotal(item).toLocaleString()}</td><td className="px-3 py-2">{item.evidence.length > 0 ? <span className="flex flex-wrap gap-2">{item.evidence.map((evidence) => <a key={evidence.id} href={evidence.url} target="_blank" rel="noreferrer">{evidence.filename}</a>)}</span> : "未附"}</td></tr>)}</tbody></table></div> : <p className="mt-2" style={{ color: "var(--text-muted)" }}>沒有逐項報帳資料。</p>}
      </div>}
    </div>
  );
}

function sourceLabel(source: string | null, event?: string | null) {
  if (source === "fund_transfer") return "資金移轉";
  if (source === "expense_claim") return "報帳";
  if (event === "opening") return "期初餘額";
  if (event?.startsWith("opening_adjustment:")) return "期初調整";
  if (event === "income") return "收入";
  return "手動登錄";
}

function isBudgetedClaimEditable(entry: FinanceJournalOut): boolean {
  return entry.status === "posted"
    && entry.claim_status === "approved"
    && entry.budget_included === true
    && (entry.payment_status || "unpaid") === "unpaid";
}

function canEditExpenseClaim(entry: FinanceJournalOut, userId: string): boolean {
  if (entry.source_type !== "expense_claim" || entry.created_by_id !== userId) return false;
  return ["pending_review", "returned"].includes(entry.claim_status || "")
    || isBudgetedClaimEditable(entry);
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
    return { title: "等待補正", detail: "提出人補正後，案件會重新進入覆核。" };
  }
  if (!isApprovedClaim(entry)) {
    return { title: "等待覆核確認", detail: "具有「覆核案件」權限的人員確認後才能繼續處理。" };
  }
  if (entry.claim_status === "completed") {
    return { title: "流程已完成", detail: "已完成核銷，這筆支出已計入期末決算。" };
  }

  if (!entry.budget_included) {
    return { title: "列入已核准預算", detail: "預算案核准且報帳品項完成對應後，才能請購或付款。" };
  }
  if (["requested", "ordered"].includes(entry.procurement_status || "not_required")) {
    return { title: "校商請購追蹤", detail: "請持續更新請購狀態，直到收貨完成。" };
  }
  if ((entry.payment_status || "unpaid") === "unpaid") {
    return { title: entry.payment_method === "advance" ? "償還個人代墊" : "登錄付款", detail: "請由具備付款權限的人員完成付款。" };
  }
  if (!entry.evidence_complete) {
    return { title: "上傳憑證", detail: "完成付款後，至少需附上一份收據、發票或其他憑證。" };
  }
  return { title: "完成核銷", detail: "確認憑證後完成核銷，這筆支出才會計入期末決算。" };
}

function claimFlowFor(entry: FinanceJournalOut): ClaimFlowStep[] {
  const isReturned = entry.claim_status === "returned";
  const approved = isApprovedClaim(entry);
  const procurementStatus = entry.procurement_status || "not_required";
  const paymentStatus = entry.payment_status || "unpaid";
  const budgetIncluded = entry.budget_included === true;
  const paid = paymentStatus !== "unpaid";
  const completed = entry.claim_status === "completed";

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
      detail: isReturned ? "退回補正" : approved ? "已確認" : "待覆核確認",
      state: isReturned ? "attention" : approved ? "done" : "active",
    },
    {
      order: 3,
      label: "列入預算",
      detail: !approved ? "覆核後處理" : budgetIncluded ? "已對應已核准預算" : "等待預算案核准與列管",
      state: !approved ? "waiting" : budgetIncluded ? "done" : "active",
    },
    {
      order: 4,
      label: "請購／付款",
      detail: !budgetIncluded ? "列入預算後處理" : paymentStatus === "unpaid" ? (procurementStatus === "not_required" ? "等待付款" : procurementStatusLabel[procurementStatus]) : paymentStatusLabel[paymentStatus],
      state: !budgetIncluded ? "waiting" : paymentStatus === "unpaid" ? "active" : "done",
    },
    {
      order: 5,
      label: "上傳憑證",
      detail: !paid ? "付款後確認" : entry.evidence_complete ? "憑證已附" : "等待憑證",
      state: !paid ? "waiting" : entry.evidence_complete ? "done" : "active",
    },
    {
      order: 6,
      label: "完成核銷",
      detail: !entry.evidence_complete ? "憑證確認後完成" : completed ? "已計入期末決算" : "等待完成核銷",
      state: completed ? "done" : entry.evidence_complete ? "active" : "waiting",
    },
  ];
}
