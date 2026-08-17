import type { ReactNode } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";

export default async function PublicRouteShell({ children }: { children: ReactNode }) {
  // The urgent banner is non-critical chrome and is loaded by the client
  // header after the first paint. Keep the shared SSR shell to one cached
  // request so every public route avoids waiting on a second API call.
  const bundle = await fetchPublicBundle();

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
    >
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
    </PublicSiteShell>
  );
}
