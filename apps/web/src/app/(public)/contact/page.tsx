import type { Metadata } from "next";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";

export const metadata: Metadata = {
  title: "聯絡我們",
  description: "班聯會公開聯絡方式與聯繫說明。",
};

export default async function ContactPage() {
  const bundle = await fetchPublicBundle();
  const settings = bundle?.settings;
  const markdown = settings?.contact_md?.trim() ?? "";

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={settings}>
      <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6 lg:pt-12">
        <header className="public-page-head mb-8">
          <p className="public-section-kicker">Contact HCCA</p>
          <h1 className="mt-2 text-3xl font-bold">聯絡我們</h1>
          <p className="mt-3 max-w-2xl text-base leading-8 text-[var(--text-secondary)]">
            需要協助、想提供建議，或想了解班聯會的公共工作？公開聯絡方式整理在這裡。
          </p>
        </header>

        <section className="card p-6 sm:p-8" data-reveal>
          {markdown ? (
            <MarkdownBlock markdown={markdown} />
          ) : (
            <p className="text-sm leading-7 text-[var(--text-secondary)]">聯絡方式尚未設定，請稍後再回來查看。</p>
          )}
        </section>
      </div>
    </PublicSiteShell>
  );
}
