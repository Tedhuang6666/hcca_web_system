"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { siteApi } from "@/lib/api";
import type { PublicLinkOut, PublicSiteBundleOut } from "@/lib/types";

export default function LinksPage() {
  const [data, setData] = useState<PublicSiteBundleOut | null>(null);

  useEffect(() => {
    siteApi.public().then(setData).catch(() => setData(null));
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicLinkOut[]>();
    for (const link of data?.links ?? []) {
      const key = link.category?.title ?? "其他連結";
      map.set(key, [...(map.get(key) ?? []), link]);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <PublicSiteShell navPages={data?.nav_pages ?? []} settings={data?.settings}>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <header className="mb-8 text-center">
          <p className="text-sm font-semibold text-[var(--primary)]">Linktree</p>
          <h1 className="mt-2 text-3xl font-bold">平台連結</h1>
          <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">
            班聯會各平台、表單、社群與公開資料入口集中於此。
          </p>
        </header>
        <div className="space-y-6">
          {grouped.map(([category, links]) => (
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
          {grouped.length === 0 && (
            <div className="card p-10 text-center text-sm text-[var(--text-muted)]">
              目前尚未設定公開連結
            </div>
          )}
        </div>
      </div>
    </PublicSiteShell>
  );
}
