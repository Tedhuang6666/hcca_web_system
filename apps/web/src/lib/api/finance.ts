import type {
  ChartAccountCreate,
  ChartAccountOut,
  ChartAccountUpdate,
  FinanceExpenseClaimCreate,
  FinanceBudget,
  FinanceBudgetAllocation,
  FinanceBudgetDetail,
  FinanceBudgetImportResult,
  FinanceBudgetSubmission,
  FinanceExpenseClaimItemOut,
  ExpenseBudgetUpdate,
  FinanceJournalOut,
  ExpenseProcurementUpdate,
  FinanceEvidenceUploadOut,
  FinanceSettlement,
  FundAccountOut,
  JournalCreate,
  LedgerOut,
  PeriodCreate,
  PeriodOut,
  TransferCreate,
} from "@/lib/types";
import { ApiError, BASE, csrfHeaders, errorMessageFromResponse, get, patch, post, silentRefresh, uploadWithProgress } from "./core";

async function postForm<T>(path: string, form: FormData): Promise<T> {
  const doFetch = () => uploadWithProgress(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders("POST"),
    body: form,
  });
  let response = await doFetch();
  if (response.status === 401 && await silentRefresh()) response = await doFetch();
  if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
  return response.json() as Promise<T>;
}

export const financeApi = {
  uploadEvidence: async (ledgerId: string, file: File, onProgress?: (progress: number) => void): Promise<FinanceEvidenceUploadOut> => {
    const form = new FormData();
    form.append("file", file);
    const doFetch = () => uploadWithProgress(`${BASE}/finance/ledgers/${ledgerId}/evidence`, {
      method: "POST",
      credentials: "include",
      headers: csrfHeaders("POST"),
      body: form,
    }, onProgress);
    let response = await doFetch();
    if (response.status === 401 && await silentRefresh()) response = await doFetch();
    if (!response.ok) throw new ApiError(response.status, await errorMessageFromResponse(response));
    return response.json();
  },
  getLedger: (id: string) => get<LedgerOut>(`/finance/ledgers/${id}`),
  createLedger: (body: { org_id: string; name: string }) => post<LedgerOut>("/finance/ledgers", body),
  listAccounts: (ledgerId: string) => get<ChartAccountOut[]>(`/finance/ledgers/${ledgerId}/accounts`),
  createAccount: (ledgerId: string, body: ChartAccountCreate) =>
    post<ChartAccountOut>(`/finance/ledgers/${ledgerId}/accounts`, body),
  updateAccount: (ledgerId: string, accountId: string, body: ChartAccountUpdate) =>
    patch<ChartAccountOut>(`/finance/ledgers/${ledgerId}/accounts/${accountId}`, body),
  listFunds: (ledgerId: string) => get<FundAccountOut[]>(`/finance/ledgers/${ledgerId}/funds`),
  createPeriod: (ledgerId: string, body: PeriodCreate) =>
    post<PeriodOut>(`/finance/ledgers/${ledgerId}/periods`, body),
  listPeriods: (ledgerId: string) => get<PeriodOut[]>(`/finance/ledgers/${ledgerId}/periods`),
  createJournal: (ledgerId: string, body: JournalCreate) =>
    post<FinanceJournalOut>(`/finance/ledgers/${ledgerId}/journals`, body),
  createExpenseClaim: (ledgerId: string, body: FinanceExpenseClaimCreate) =>
    post<FinanceJournalOut>(`/finance/ledgers/${ledgerId}/expense-claims`, body),
  updateExpenseClaim: (entryId: string, body: FinanceExpenseClaimCreate) =>
    patch<FinanceJournalOut>(`/finance/journals/${entryId}/expense-claim`, body),
  listJournals: (ledgerId: string, status?: string) =>
    get<FinanceJournalOut[]>(`/finance/ledgers/${ledgerId}/journals${status ? `?status=${status}` : ""}`),
  listClaimItems: (entryId: string) =>
    get<FinanceExpenseClaimItemOut[]>(`/finance/journals/${entryId}/claim-items`),
  createTransfer: (ledgerId: string, body: TransferCreate) =>
    post<FinanceJournalOut>(`/finance/ledgers/${ledgerId}/transfers`, body),
  submit: (entryId: string) => post<FinanceJournalOut>(`/finance/journals/${entryId}/submit`, {}),
  post: (entryId: string) => post<FinanceJournalOut>(`/finance/journals/${entryId}/post`, {}),
  returnClaim: (entryId: string, note: string) =>
    post<FinanceJournalOut>(`/finance/journals/${entryId}/return`, { note }),
  updateProcurement: (entryId: string, body: ExpenseProcurementUpdate) =>
    patch<FinanceJournalOut>(`/finance/journals/${entryId}/procurement`, body),
  markSchoolPaid: (entryId: string) =>
    post<FinanceJournalOut>(`/finance/journals/${entryId}/school-payment`, {}),
  markDuesPaid: (entryId: string) =>
    post<FinanceJournalOut>(`/finance/journals/${entryId}/dues-payment`, {}),
  completeClaim: (entryId: string) => post<FinanceJournalOut>(`/finance/journals/${entryId}/complete`, {}),
  updateBudget: (entryId: string, body: ExpenseBudgetUpdate) =>
    patch<FinanceJournalOut>(`/finance/journals/${entryId}/budget`, body),
  listBudgets: (ledgerId: string) => get<FinanceBudget[]>(`/finance/ledgers/${ledgerId}/budgets`),
  createBudget: (ledgerId: string, body: { period_id: string; name: string }) =>
    post<FinanceBudget>(`/finance/ledgers/${ledgerId}/budgets`, body),
  importBudget: (ledgerId: string, body: {
    file: File; period_id: string; name: string; title?: string; proposing_org_id?: string;
  }) => {
    const form = new FormData();
    form.append("file", body.file);
    form.append("period_id", body.period_id);
    form.append("name", body.name);
    if (body.title) form.append("title", body.title);
    if (body.proposing_org_id) form.append("proposing_org_id", body.proposing_org_id);
    return postForm<FinanceBudgetImportResult>(`/finance/ledgers/${ledgerId}/budgets/import`, form);
  },
  getBudget: (budgetId: string) => get<FinanceBudgetDetail>(`/finance/budgets/${budgetId}`),
  updateBudgetPublication: (budgetId: string, isPublic: boolean) =>
    patch<FinanceBudget>(`/finance/budgets/${budgetId}/publication`, { is_public: isPublic }),
  createBudgetSubmission: (budgetId: string, body: { kind: 'initial' | 'supplemental'; title: string; note?: string }) =>
    post<FinanceBudgetSubmission>(`/finance/budgets/${budgetId}/submissions`, body),
  createBudgetNode: (submissionId: string, body: { parent_id?: string | null; name: string; sort_order?: number }) =>
    post(`/finance/budget-submissions/${submissionId}/nodes`, body),
  createBudgetAllocation: (submissionId: string, body: {
    node_id: string; proposing_org_id: string; amount?: number; quantity?: number; unit?: string; unit_price?: number; note?: string
  }) =>
    post<FinanceBudgetAllocation>(`/finance/budget-submissions/${submissionId}/allocations`, body),
  updateBudgetDraftAllocation: (submissionId: string, allocationId: string, body: {
    node_id: string; proposing_org_id: string; amount?: number; quantity?: number;
    unit?: string; unit_price?: number; note?: string;
  }) =>
    patch<FinanceBudgetAllocation>(
      `/finance/budget-submissions/${submissionId}/allocations/${allocationId}`,
      body,
    ),
  submitBudget: (submissionId: string) => post<FinanceBudgetSubmission>(`/finance/budget-submissions/${submissionId}/submit`, {}),
  reviewBudget: (submissionId: string, body: { status: 'approved' | 'returned' | 'rejected'; note?: string }) =>
    post<FinanceBudgetSubmission>(`/finance/budget-submissions/${submissionId}/review`, body),
  updateBudgetAllocation: (allocationId: string, body: { amount: number; reason: string }) =>
    patch<FinanceBudgetAllocation>(`/finance/budget-allocations/${allocationId}`, body),
  getSettlement: (ledgerId: string, periodId: string) =>
    get<FinanceSettlement>(`/finance/ledgers/${ledgerId}/periods/${periodId}/settlement`),
  reimburseAdvance: (entryId: string, body: { period_id: string; entry_date: string; fund_account_id: string; payment_status?: 'school_paid' | 'dues_paid'; note?: string }) =>
    post<FinanceJournalOut>(`/finance/journals/${entryId}/reimburse-advance`, body),
};
