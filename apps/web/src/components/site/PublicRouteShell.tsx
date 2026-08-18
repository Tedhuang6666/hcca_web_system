import type { ReactNode } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";

export default async function PublicRouteShell({ children }: { children: ReactNode }) {
  // The public bundle and the shell's independently cached urgent announcement
  // keep the first paint stable without sending a client-side layout-changing
  // request after hydration.
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();

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
