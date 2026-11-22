import { Compass } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";

export default async function PublicRouteNotFound() {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto flex min-h-[52vh] w-full max-w-6xl items-center justify-center px-4 sm:px-6">
        <EmptyState
          icon={<Compass size={40} aria-hidden />}
          title="找不到這個頁面"
          headingLevel="h1"
          description="連結可能已更新，或該公開內容已不再提供。"
          action={{ label: "返回首頁", href: "/" }}
        />
      </div>
    </PublicSiteShell>
  );
}
