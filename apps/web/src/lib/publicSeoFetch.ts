import type { DocumentOut, RegulationOut } from "@/lib/types";

import { serverApiUrl } from "@/lib/config";

const REVALIDATE_SECONDS = 60;

async function fetchPublicJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(serverApiUrl(path), {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export async function fetchPublicRegulation(id: string): Promise<RegulationOut | null> {
  return fetchPublicJson<RegulationOut>(`/regulations/${encodeURIComponent(id)}`);
}

export async function fetchPublicDocument(id: string): Promise<DocumentOut | null> {
  return fetchPublicJson<DocumentOut>(`/documents/${encodeURIComponent(id)}`);
}
