import type { MetadataRoute } from "next";

import { serverApiUrl } from "@/lib/config";

type RegulationListItem = {
  id: string;
  title: string;
  updated_at: string;
};

type DocumentListItem = {
  id: string;
  serial_number: string;
  updated_at?: string;
  created_at: string;
};

async function pagedFetch<T>(url: URL, limit = 200): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    let res: Response;
    try {
      res = await fetch(url.toString(), { next: { revalidate: 300 } });
    } catch {
      // Build-time fallback: API 未啟動時回傳空集合，避免 sitemap prerender 失敗
      return [];
    }
    if (!res.ok) break;
    const items: T[] = await res.json();
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
    if (offset > 5000) break; // safety guard
  }
  return all;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const regUrl = new URL(serverApiUrl("/regulations"));
  regUrl.searchParams.set("active_only", "true");
  // 公開：後端會在未登入時自動只回傳已發布（本次實作會補上）
  const regs = await pagedFetch<RegulationListItem>(regUrl);

  const docUrl = new URL(serverApiUrl("/documents"));
  docUrl.searchParams.set("visibility", "publicly_open");
  const docs = await pagedFetch<DocumentListItem>(docUrl);

  const now = new Date();

  return [
    { url: `${site}/public`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${site}/public/regulations`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...regs.map((r) => ({
      url: `${site}/public/regulations/${encodeURIComponent(r.title)}`,
      lastModified: new Date(r.updated_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    { url: `${site}/public/documents`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    ...docs.map((d) => ({
      url: `${site}/public/documents/${encodeURIComponent(d.serial_number)}`,
      lastModified: new Date((d.updated_at as string | undefined) ?? d.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
  ];
}
