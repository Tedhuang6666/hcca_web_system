"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { siteApi } from "@/lib/api";
import type { PublicSiteBundleOut, PublicSitePageOut } from "@/lib/types";

export default function CmsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [bundle, setBundle] = useState<PublicSiteBundleOut | null>(null);
  const [page, setPage] = useState<PublicSitePageOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([siteApi.public(), siteApi.publicPage(slug)])
      .then(([nextBundle, nextPage]) => {
        setBundle(nextBundle);
        setPage(nextPage);
      })
      .catch(() => {
        setBundle(null);
        setPage(null);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {loading ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">載入中...</div>
        ) : !page ? (
          <div className="card p-10 text-center text-sm text-[var(--text-muted)]">找不到頁面</div>
        ) : (
          <article className="space-y-6">
            <header>
              <p className="text-sm font-semibold text-[var(--primary)]">Public Page</p>
              <h1 className="mt-2 text-3xl font-bold">{page.title}</h1>
              {page.summary && (
                <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--text-secondary)]">
                  {page.summary}
                </p>
              )}
            </header>
            {page.cover_image_url && (
              <Image
                src={page.cover_image_url}
                alt={page.cover_image_alt || page.title}
                width={1200}
                height={360}
                unoptimized
                className="max-h-[360px] w-full rounded-lg object-cover"
              />
            )}
            <div className="card p-5 md:p-7">
              <MarkdownBlock markdown={page.body_md} />
            </div>
          </article>
        )}
      </div>
    </PublicSiteShell>
  );
}
