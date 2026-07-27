import Link from "next/link";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";

export default async function SystemInfoPage() {
  const bundle = await fetchPublicBundle();
  const settings = bundle?.settings;
  const sections = [
    { id: "support", title: "需要協助嗎？", markdown: settings?.support_md },
    { id: "error-report", title: "錯誤報告", markdown: settings?.error_report_md },
    { id: "contact", title: "聯絡資訊", markdown: settings?.contact_md },
    { id: "terms", title: "使用者條款", markdown: settings?.terms_md },
    { id: "developer-team", title: "開發團隊", markdown: settings?.developer_team_md },
  ].filter((item) => item.markdown?.trim());

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={settings}>
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 lg:pt-12">
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">System information</p>
          <h1 className="mt-2 text-3xl font-bold">關於本系統</h1>
          <p className="mt-3 max-w-2xl text-base leading-8 text-[var(--text-secondary)]">
            使用平台前後需要知道的協助方式、回報管道與公開說明，都整理在這裡。
          </p>
        </header>

        {sections.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2">
            {sections.map((section) => (
              <section key={section.id} className="card p-5" data-reveal>
                <h2 className="mb-3 text-lg font-semibold">{section.title}</h2>
                <MarkdownBlock markdown={section.markdown} />
              </section>
            ))}
          </div>
        ) : (
          <section className="card p-6 text-sm leading-7 text-[var(--text-secondary)]">
            系統資訊尚未設定，請稍後再回來查看。
          </section>
        )}

        <Link href="/about" className="public-text-link mt-8 inline-flex">
          查看關於班聯會與幹部名單
        </Link>
      </div>
    </PublicSiteShell>
  );
}
