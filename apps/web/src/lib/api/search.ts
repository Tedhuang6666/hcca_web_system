import type {
  SearchResultOut,
} from "../types";
import { get, post } from "./core";

export const searchApi = {
  global: (q: string, limit = 10) =>
    get<SearchResultOut[]>(`/search?${new URLSearchParams({ q, limit: String(limit) })}`),
  reindex: () => post<{ enabled: boolean; indexed: number; index?: string | null }>(
    "/search/reindex",
    {},
  ),
};
