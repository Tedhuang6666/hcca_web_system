import Image from "next/image";
import { notFound } from "next/navigation";

import MarkdownBlock from "@/components/site/MarkdownBlock";
import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle, fetchPublicPage } from "@/lib/serverFetch";

export default async function CmsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [bundle, page] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicPage(slug),
  ]);

  if (!page) notFound();

  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
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
      </div>
    </PublicSiteShell>
  );
}
