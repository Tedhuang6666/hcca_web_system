import type { ReactNode } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchActiveUrgentAnnouncement, fetchPublicBundle } from "@/lib/serverFetch";

export default async function PublicRouteShell({ children }: { children: ReactNode }) {
  const [bundle, urgentAnnouncement] = await Promise.all([
    fetchPublicBundle(),
    fetchActiveUrgentAnnouncement(),
  ]);

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
    </PublicSiteShell>
  );
}
