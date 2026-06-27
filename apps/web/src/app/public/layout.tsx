import type { ReactNode } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";

export default async function PublicDatabaseLayout({ children }: { children: ReactNode }) {
  const bundle = await fetchPublicBundle();

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
    </PublicSiteShell>
  );
}
