import MerchandiseSubmissionsPageClient from "./page-client";
import type { MerchandiseSubmissionPortalOut } from "@/lib/types";
import { privateServerData, serverRequest } from "@/lib/server/request";

async function loadPortal(): Promise<MerchandiseSubmissionPortalOut | null> {
  try {
    return await serverRequest<MerchandiseSubmissionPortalOut>(
      "/merchandise-submissions/portal",
      privateServerData,
    );
  } catch {
    // The client still retries through the normal auth-aware API client when
    // the server-side session is temporarily unavailable.
    return null;
  }
}

export default async function MerchandiseSubmissionsPage() {
  return <MerchandiseSubmissionsPageClient initialPortal={await loadPortal()} />;
}
