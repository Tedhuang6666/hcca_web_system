import type {
  DocumentOut,
  PetitionPublicListItem,
  PetitionPublicOut,
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
  return fetchPublicJson<DocumentOut>(`/documents/${encodeURIComponent(id)}`);
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
