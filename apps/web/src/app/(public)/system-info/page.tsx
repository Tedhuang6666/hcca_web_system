import Link from "@/components/ui/IntentLink";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";
import { getSystemInfoMarkdown } from "@/lib/systemInfoMarkdown";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "關於本系統",
  description: "新竹高中班聯會數位整合系統的使用協助、回報管道與公開說明。",
  path: "/system-info",
  type: "website",
});

export default async function SystemInfoPage() {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();
  const settings = bundle?.settings;
  const systemInfoMarkdown = settings ? getSystemInfoMarkdown(settings) : "";

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 lg:pt-12">
        <header className="public-page-head mb-8">
          <h1 className="text-3xl font-bold">關於本系統</h1>
        </header>

        {systemInfoMarkdown ? (
          <section className="card p-6 sm:p-8">
            <MarkdownBlock markdown={systemInfoMarkdown} />
          </section>
        ) : (
          <section className="card p-6 text-sm leading-7 text-[var(--text-secondary)]">
            系統資訊尚未設定，請稍後再回來查看。
          </section>
        )}

        <section className="card mt-4 flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">發現網站有問題？</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
              功能錯誤、資料異常或資安漏洞都可以直接回報，資訊部會收到網站通知與電子郵件。
            </p>
          </div>
          <Link href="/security/report" className="public-cta-primary">
            前往回報表單
          </Link>
        </section>

      </div>
    </PublicSiteShell>
  );
}
