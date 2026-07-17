import type {
  ChartAccountCreate,
  ChartAccountOut,
  FundAccountOut,
  JournalCreate,
  JournalOut,
  LedgerOut,
  PeriodCreate,
  PeriodOut,
  TransferCreate,
} from "@/lib/types";
import { get, post } from "./core";

export const financeApi = {
  getLedger: (id: string) => get<LedgerOut>(`/finance/ledgers/${id}`),
  createLedger: (body: { org_id: string; name: string }) => post<LedgerOut>("/finance/ledgers", body),
  listAccounts: (ledgerId: string) => get<ChartAccountOut[]>(`/finance/ledgers/${ledgerId}/accounts`),
  createAccount: (ledgerId: string, body: ChartAccountCreate) =>
    post<ChartAccountOut>(`/finance/ledgers/${ledgerId}/accounts`, body),
  listFunds: (ledgerId: string) => get<FundAccountOut[]>(`/finance/ledgers/${ledgerId}/funds`),
  createPeriod: (ledgerId: string, body: PeriodCreate) =>
    post<PeriodOut>(`/finance/ledgers/${ledgerId}/periods`, body),
  createJournal: (ledgerId: string, body: JournalCreate) =>
    post<JournalOut>(`/finance/ledgers/${ledgerId}/journals`, body),
  listJournals: (ledgerId: string, status?: string) =>
    get<JournalOut[]>(`/finance/ledgers/${ledgerId}/journals${status ? `?status=${status}` : ""}`),
  createTransfer: (ledgerId: string, body: TransferCreate) =>
    post<JournalOut>(`/finance/ledgers/${ledgerId}/transfers`, body),
  submit: (entryId: string) => post<JournalOut>(`/finance/journals/${entryId}/submit`, {}),
  post: (entryId: string) => post<JournalOut>(`/finance/journals/${entryId}/post`, {}),
};
