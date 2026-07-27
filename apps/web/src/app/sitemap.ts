import type { MetadataRoute } from "next";

import { regulationHref } from "@/lib/api/regulations";
import { BRANDING } from "@/lib/branding";
import { serverApiUrl } from "@/lib/config";
import { resolvePublicNav } from "@/lib/publicNav";
import type { PublicSiteBundleOut } from "@/lib/types";

// Sitemap 必須在請求時讀取資料庫；若只在 build time 產生，API 尚未啟動時
// 會把暫時的空集合快取成只有固定入口的 sitemap。
export const dynamic = "force-dynamic";

const INDEXABLE_SITE_URL = `https://${BRANDING.domain}`;

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

type AnnouncementListItem = {
  id: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
};

type PublicElectionListItem = {
  id: string;
  slug: string | null;
  updated_at: string;
};

type PublicModuleStatusListItem = {
  id: string;
  on: boolean;
  mode: "maintenance" | "closed";
};

type PublicSitePageListItem = {
  slug: string;
  updated_at: string;
  is_published: boolean;
};

const FETCH_TIMEOUT_MS = 4000;

async function fetchJson<T>(url: URL): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pagedFetch<T>(url: URL, limit = 100): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const items = await fetchJson<T[]>(url);
    if (!items) return [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
    if (offset > 5000) break; // safety guard
  }
  return all;
}

function visiblePublicNavItems(
  bundle: Pick<PublicSiteBundleOut, "settings"> | null,
  moduleStatuses: PublicModuleStatusListItem[] | null,
) {
  const closedModules = new Set(
    (moduleStatuses ?? [])
      .filter((item) => item.on && item.mode === "closed")
      .map((item) => item.id),
  );

  return resolvePublicNav(bundle?.settings.theme_config).filter(
    (item) => !item.hidden && (!item.moduleId || !closedModules.has(item.moduleId)),
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = INDEXABLE_SITE_URL;
  const now = new Date();

  const [bundle, moduleStatuses, publicPages] = await Promise.all([
    fetchJson<Pick<PublicSiteBundleOut, "settings">>(new URL(serverApiUrl("/site/public"))),
    fetchJson<PublicModuleStatusListItem[]>(new URL(serverApiUrl("/system/module-status"))),
    fetchJson<PublicSitePageListItem[]>(new URL(serverApiUrl("/site/pages"))),
  ]);
  const visibleNavItems = visiblePublicNavItems(bundle, moduleStatuses);
  const visibleNavKeys = new Set(visibleNavItems.map((item) => item.key));
  const hasNavItem = (key: string) => visibleNavKeys.has(key);

  const [regs, docs, announcements, elections] = await Promise.all([
    hasNavItem("regulations")
      ? (() => {
          const url = new URL(serverApiUrl("/regulations"));
          url.searchParams.set("active_only", "true");
          return pagedFetch<RegulationListItem>(url);
        })()
      : Promise.resolve([] as RegulationListItem[]),
    hasNavItem("documents")
      ? (() => {
          const url = new URL(serverApiUrl("/documents"));
          url.searchParams.set("visibility", "publicly_open");
          return pagedFetch<DocumentListItem>(url);
        })()
      : Promise.resolve([] as DocumentListItem[]),
    hasNavItem("news")
      ? pagedFetch<AnnouncementListItem>(new URL(serverApiUrl("/announcements"))).then((items) =>
          items.filter((item) => item.is_published),
        )
      : Promise.resolve([] as AnnouncementListItem[]),
    hasNavItem("elections")
      ? fetchJson<PublicElectionListItem[]>(new URL(serverApiUrl("/elections/public"))).then(
          (items) => items ?? [],
        )
      : Promise.resolve([] as PublicElectionListItem[]),
  ]);

  const navEntries = visibleNavItems.map((item) => ({
    url: `${site}${item.href}`,
    lastModified: now,
    changeFrequency: ["about", "system-info", "officers", "links"].includes(item.key)
      ? ("monthly" as const)
      : ("daily" as const),
    priority: item.key === "public-db" ? 0.6 : item.group === "primary" ? 0.8 : 0.7,
  }));

  return [
    { url: `${site}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...navEntries,
    ...announcements.map((a) => ({
      url: `${site}/news/${encodeURIComponent(a.id)}`,
      lastModified: new Date(a.published_at ?? a.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...regs.map((r) => ({
      url: `${site}${regulationHref(r)}`,
      lastModified: new Date(r.updated_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...docs.map((d) => ({
      url: `${site}/documents/${encodeURIComponent(d.serial_number)}`,
      lastModified: new Date((d.updated_at as string | undefined) ?? d.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    })),
    ...elections.map((election) => ({
      url: `${site}/live/elections/${encodeURIComponent(election.slug ?? election.id)}`,
      lastModified: new Date(election.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
    ...(publicPages ?? [])
      .filter((page) => page.is_published && page.slug)
      .map((page) => ({
        url: `${site}/pages/${encodeURIComponent(page.slug)}`,
        lastModified: new Date(page.updated_at),
        changeFrequency: "monthly" as const,
        priority: 0.5,
      })),
  ];
}
