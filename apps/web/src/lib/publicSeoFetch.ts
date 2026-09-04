import type {
  DocumentOut,
  PetitionPublicListItem,
  PetitionPublicOut,
  PublicBudgetDetail,
  PublicBudgetListItem,
  RegulationOut,
} from "@/lib/types";
import { fetchPublicJson as fetchCachedPublicJson } from "@/lib/serverFetch";

async function fetchPublicJson<T>(path: string): Promise<T | null> {
  return fetchCachedPublicJson<T>(path);
}

export async function fetchPublicRegulation(id: string): Promise<RegulationOut | null> {
  return fetchPublicJson<RegulationOut>(`/regulations/${encodeURIComponent(id)}`);
}

export async function fetchPublicDocument(id: string): Promise<DocumentOut | null> {
  // 公文可見度可能在建立後才切換為公開；避免把切換前的 404/null
  // 以一般公開內容快取保留 5 分鐘，導致公開連結持續顯示不存在。
  return fetchCachedPublicJson<DocumentOut>(
    `/documents/${encodeURIComponent(id)}`,
    { revalidate: 15 },
  );
}

export async function fetchPublicPetitions(
  params: { limit?: number; offset?: number } = {},
): Promise<PetitionPublicListItem[]> {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.offset !== undefined) search.set("offset", String(params.offset));
  const query = search.size ? `?${search.toString()}` : "";
  return (await fetchPublicJson<PetitionPublicListItem[]>(`/petitions/public${query}`)) ?? [];
}

export async function fetchPublicPetition(id: string): Promise<PetitionPublicOut | null> {
  return fetchPublicJson<PetitionPublicOut>(`/petitions/public/${encodeURIComponent(id)}`);
}

export async function fetchPublicBudgets(): Promise<PublicBudgetListItem[]> {
  return (await fetchCachedPublicJson<PublicBudgetListItem[]>(
    "/finance/public/budgets",
    { revalidate: 15 },
  )) ?? [];
}

export async function fetchPublicBudget(
  id: string,
  reviewSubmissionId?: string,
): Promise<PublicBudgetDetail | null> {
  const query = reviewSubmissionId
    ? `?review_submission_id=${encodeURIComponent(reviewSubmissionId)}`
    : "";
  return fetchCachedPublicJson<PublicBudgetDetail>(
    `/finance/public/budgets/${encodeURIComponent(id)}${query}`,
    { revalidate: 15 },
  );
}
