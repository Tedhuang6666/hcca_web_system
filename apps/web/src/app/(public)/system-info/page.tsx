import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";
import { getSystemInfoMarkdown } from "@/lib/systemInfoMarkdown";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "關於本系統",
  description: "HCCA 校園自治整合平台的使用協助、回報管道與公開說明。",
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

      </div>
    </PublicSiteShell>
  );
}
