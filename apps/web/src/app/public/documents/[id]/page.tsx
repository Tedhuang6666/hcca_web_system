import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PublicSiteShell from "@/components/site/PublicSiteShell";
import { fetchPublicBundle } from "@/lib/serverFetch";
import { fetchPublicDocument } from "@/lib/publicSeoFetch";
import { uploadUrl } from "@/lib/config";
import { JsonLd, absoluteUrl, excerpt, pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const document = await fetchPublicDocument(id);
  const title = document?.title ?? "公開公文";
  return pageMetadata({
    title,
    description: excerpt(document?.subject ?? document?.doc_description ?? document?.content, "新竹高中班聯會公開公文。"),
    path: `/public/documents/${encodeURIComponent(id)}`,
  });
}

export default async function PublicDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [bundle, document] = await Promise.all([
    fetchPublicBundle(),
    fetchPublicDocument(id),
  ]);
  if (!document) notFound();

  const path = `/public/documents/${encodeURIComponent(id)}`;
  return (
    <PublicSiteShell navPages={bundle?.nav_pages ?? []} settings={bundle?.settings}>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "DigitalDocument",
            name: document.title,
            headline: document.subject || document.title,
            description: excerpt(document.doc_description ?? document.content, "公開公文。"),
            dateCreated: document.created_at,
            dateModified: document.updated_at,
            datePublished: document.issued_at,
            identifier: document.serial_number,
            url: absoluteUrl(path),
            isPartOf: { "@type": "CollectionPage", name: "公開公文資料庫" },
          }}
        />
        <article>
          <header className="public-page-head mb-8">
            <p className="public-section-kicker">Public Document</p>
            <h1 className="mt-2 text-3xl font-bold">{document.title}</h1>
            <dl className="mt-5 grid gap-3 text-sm text-[var(--public-secondary)] sm:grid-cols-2">
              <div><dt className="font-semibold text-[var(--public-muted)]">發文字號</dt><dd className="mt-1">{document.serial_number || "未編號"}</dd></div>
              {document.issued_at && <div><dt className="font-semibold text-[var(--public-muted)]">發文日期</dt><dd className="mt-1">{new Date(document.issued_at).toLocaleDateString("zh-TW")}</dd></div>}
              {document.handler_unit && <div><dt className="font-semibold text-[var(--public-muted)]">承辦單位</dt><dd className="mt-1">{document.handler_unit}</dd></div>}
              {document.category && <div><dt className="font-semibold text-[var(--public-muted)]">類別</dt><dd className="mt-1">{document.category}</dd></div>}
            </dl>
          </header>
          {document.subject && <section className="mb-6 rounded-xl border border-[var(--public-border)] bg-[var(--public-soft)] p-5"><h2 className="text-sm font-semibold text-[var(--public-muted)]">主旨</h2><p className="mt-2 leading-8">{document.subject}</p></section>}
          <section className="rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6 sm:p-8">
            <h2 className="text-lg font-semibold">公文內容</h2>
            <p className="mt-4 whitespace-pre-wrap leading-8">{document.content || document.doc_description || "本公文未提供可公開顯示的正文。"}</p>
          </section>
          {document.attachments?.length > 0 && (
            <section className="mt-6 rounded-2xl border border-[var(--public-border)] bg-[var(--public-surface)] p-6">
              <h2 className="text-lg font-semibold">公開附件</h2>
              <ul className="mt-4 space-y-3">
                {document.attachments.map((attachment) => {
                  const href = attachment.link_url || uploadUrl(attachment.url);
                  return href ? <li key={attachment.id}><a href={href} className="text-sm font-semibold text-[var(--public-accent)] underline underline-offset-4">{attachment.display_name || attachment.filename}</a></li> : null;
                })}
              </ul>
            </section>
          )}
        </article>
      </div>
    </PublicSiteShell>
  );
}
