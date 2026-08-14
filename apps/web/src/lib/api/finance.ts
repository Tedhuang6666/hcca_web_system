import type {
  ChartAccountCreate,
  ChartAccountOut,
  ChartAccountUpdate,
  FinanceExpenseClaimCreate,
  ExpenseBudgetUpdate,
  FinanceJournalOut,
  ExpenseProcurementUpdate,
  FinanceEvidenceUploadOut,
  FundAccountOut,
  JournalCreate,
  LedgerOut,
  PeriodCreate,
  PeriodOut,
  TransferCreate,
} from "@/lib/types";
import { ApiError, BASE, csrfHeaders, errorMessageFromResponse, get, patch, post, silentRefresh, uploadWithProgress } from "./core";

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
  listJournals: (ledgerId: string, status?: string) =>
    get<FinanceJournalOut[]>(`/finance/ledgers/${ledgerId}/journals${status ? `?status=${status}` : ""}`),
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
  updateBudget: (entryId: string, body: ExpenseBudgetUpdate) =>
    patch<FinanceJournalOut>(`/finance/journals/${entryId}/budget`, body),
};
