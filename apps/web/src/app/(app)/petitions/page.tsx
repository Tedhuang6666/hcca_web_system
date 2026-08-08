import type { PetitionPublicListItem } from "@/lib/types";
import { serverApiUrl } from "@/lib/config";
import PetitionsPageClient from "./PetitionsPageClient";

const PUBLIC_PETITIONS_REVALIDATE_SECONDS = 30;

async function fetchInitialPublicCases(): Promise<PetitionPublicListItem[]> {
  try {
    const response = await fetch(`${serverApiUrl("/petitions/public")}?limit=6`, {
      next: { revalidate: PUBLIC_PETITIONS_REVALIDATE_SECONDS },
    });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

export default async function PetitionsPage() {
  const initialPublicCases = await fetchInitialPublicCases();
  return <PetitionsPageClient initialPublicCases={initialPublicCases} />;
}
