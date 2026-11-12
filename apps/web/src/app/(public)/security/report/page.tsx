import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";
import SecurityReportForm from "./SecurityReportForm";

export const metadata = pageMetadata({
  title: "漏洞與問題回報",
  description: "回報竹嶺班聯會公開網站的資安漏洞、功能錯誤或資料異常。",
  path: "/security/report",
  type: "website",
});

export default async function SecurityReportPage() {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();
  const settings = bundle?.settings;

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 lg:pt-12">
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">Responsible disclosure</p>
          <h1 className="mt-2 text-3xl font-bold">漏洞與問題回報</h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--text-secondary)]">
            發現網站有資安漏洞、頁面錯誤或資料顯示異常嗎？請盡量提供可重現的步驟與所在網址，
            我們會依影響程度安排處理。資安漏洞在修正完成前，請避免公開細節。
          </p>
        </header>

        <SecurityReportForm />
      </div>
    </PublicSiteShell>
  );
}
