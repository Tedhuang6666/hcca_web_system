import PublicOfficerDirectory from "@/components/site/PublicOfficerDirectory";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { pageMetadata } from "@/lib/seo";
import { fetchPublicOfficers, fetchPublicShellData } from "@/lib/serverFetch";

export const metadata = pageMetadata({
  title: "班聯會幹部名單",
  description: "查看新竹高中班聯會本屆幹部、組織與職務，找到適合的自治工作聯絡窗口。",
  path: "/officers",
  type: "website",
});

export default async function OfficersPage() {
  const [shellData, officers] = await Promise.all([
    fetchPublicShellData(),
    fetchPublicOfficers(),
  ]);
  const bundle = shellData.bundle;

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={shellData.urgentAnnouncement}
    >
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:pt-12">
        <header className="public-page-head mb-8">
          <h1 className="text-3xl font-bold">班聯會幹部</h1>
        </header>
        <PublicOfficerDirectory
          officers={officers}
          themeConfig={bundle?.settings?.theme_config}
          showFullPageLink={false}
        />
      </div>
    </PublicSiteShell>
  );
}
