import { ArrowUpRight } from "lucide-react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicShellData } from "@/lib/serverFetch";
import { pageMetadata } from "@/lib/seo";
import type { PublicLinkOut } from "@/lib/types";

export const metadata = pageMetadata({
  title: "平台連結",
  description: "班聯會各平台、表單、社群與公開資料入口。",
  path: "/links",
  type: "website",
});

export default async function LinksPage() {
  const { bundle, urgentAnnouncement } = await fetchPublicShellData();

  const grouped = new Map<string, PublicLinkOut[]>();
  for (const link of bundle?.links ?? []) {
    const key = link.category?.title ?? "其他連結";
    grouped.set(key, [...(grouped.get(key) ?? []), link]);
  }
  const groupEntries = Array.from(grouped.entries());

  return (
    <PublicSiteShell
      navPages={bundle?.nav_pages ?? []}
      settings={bundle?.settings}
      urgentAnnouncement={urgentAnnouncement}
    >
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">平台連結</h1>
        </header>
        <div className="space-y-6">
          {groupEntries.map(([category, links]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--text-muted)]">{category}</h2>
              <div className="space-y-3">
                {links.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="card card-hover flex min-h-14 items-center justify-between gap-3 p-4 no-underline">
                    <span className="min-w-0">
                      <span className="block font-semibold text-[var(--text-primary)]">
                        {link.title}
                      </span>
                      {link.description && (
                        <span className="mt-1 block text-sm leading-6 text-[var(--text-muted)]">
                          {link.description}
                        </span>
                      )}
                    </span>
                    <ArrowUpRight size={18} className="shrink-0 text-[var(--primary)]" aria-hidden />
                  </a>
                ))}
              </div>
            </section>
          ))}
          {groupEntries.length === 0 && (
            <div className="card p-10 text-center text-sm text-[var(--text-muted)]">
              目前尚未設定公開連結
            </div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
