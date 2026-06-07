import type { ReactNode } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { serverApiUrl } from "@/lib/config";

export const dynamic = "force-dynamic";
import type { PublicSiteBundleOut } from "@/lib/types";

async function fetchPublicSite(): Promise<PublicSiteBundleOut | null> {
  try {
    const res = await fetch(serverApiUrl("/site/public"), { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function PublicDatabaseLayout({ children }: { children: ReactNode }) {
  const bundle = await fetchPublicSite();

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </div>
    </PublicSiteShell>
  );
}
