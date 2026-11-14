import type {
  RegulationArticleOut, RegulationListItem, RegulationOut, RegulationRevisionOut,
  RegulationSearchResult, RegulationTreeNodeOut,
} from "../types";
import { get, post, pathSegment } from "./core";

// ── 法規 ──────────────────────────────────────────────────────────────────────

const regulationPath = (id: string) => `/regulations/${pathSegment(id)}`;

export const regulationHref = (reg: { id: string; title?: string | null }) =>
  regulationPath(reg.id);

export const regulationsApi = {
  list: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return get<RegulationListItem[]>(`/regulations${qs}`);
  },
  search: (keyword: string, params?: Record<string, string>) => {
    const base: Record<string, string> = { keyword, ...params };
    return get<RegulationSearchResult[]>(
      `/regulations/search?${new URLSearchParams(base).toString()}`,
    );
  },
  get: (id: string) => get<RegulationOut>(regulationPath(id)),
  publish: (id: string, body: { change_brief: string; is_total_amendment?: boolean; resolution_link?: string }) =>
    post<RegulationOut>(`${regulationPath(id)}/publish`, body),
  listRevisions: (id: string) => get<RegulationRevisionOut[]>(`${regulationPath(id)}/revisions`),
  listArticles: (id: string, includeDeleted = false) =>
    get<RegulationArticleOut[]>(`${regulationPath(id)}/articles${includeDeleted ? "?include_deleted=true" : ""}`),
  tree: (id: string) => get<RegulationTreeNodeOut[]>(`${regulationPath(id)}/tree`),
  referenceWarnings: (id: string) =>
    get<{ source_article_id: string; source_title: string; referenced_legal_number: string; message: string }[]>(`${regulationPath(id)}/reference-warnings`),
  timeMachine: (id: string, asOfIso: string) =>
    get<{ as_of: string; version: number; amended_at: string; content_snapshot: string; tree: RegulationTreeNodeOut[] }>(
      `${regulationPath(id)}/time-machine?${new URLSearchParams({ as_of: asOfIso }).toString()}`
    ),
};
