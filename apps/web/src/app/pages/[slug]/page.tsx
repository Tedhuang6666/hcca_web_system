"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import MarkdownBlock from "@/components/site/MarkdownBlock";
import { siteApi } from "@/lib/api";
import type { PublicSiteBundleOut, PublicSitePageOut } from "@/lib/types";

export default function CustomPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const [site, setSite] = useState<PublicSiteBundleOut | null>(null);
  const [page, setPage] = useState<PublicSitePageOut | null>(null);

  useEffect(() => {
    siteApi.public().then(setSite).catch(() => setSite(null));
    siteApi.publicPage(slug).then(setPage).catch(() => setPage(null));
  }, [slug]);

  return (
    <PublicSiteShell navPages={site?.nav_pages ?? []}>
      <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {!page ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">找不到頁面</div>
        ) : (
          <>
            {page.cover_image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.cover_image_url}
                alt={page.cover_image_alt || page.title}
                className="mb-8 aspect-[16/7] w-full rounded-lg object-cover"
              />
            )}
            <header className="mb-6">
              <p className="text-sm font-semibold text-[var(--primary)]">{page.page_kind}</p>
              <h1 className="mt-2 text-3xl font-bold">{page.title}</h1>
              {page.summary && <p className="mt-3 text-base leading-8 text-[var(--text-secondary)]">{page.summary}</p>}
            </header>
            <section className="card p-6">
              <MarkdownBlock markdown={page.body_md} />
            </section>
          </>
        )}
      </article>
    </PublicSiteShell>
  );
}
