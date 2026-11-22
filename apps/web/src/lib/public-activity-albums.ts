import { safeImageUrl } from "@/lib/config";

export type GalleryPhoto = {
  id: string;
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
  photographer?: string;
  section?: string;
  featured: boolean;
};

export type PublicActivityAlbum = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  date?: string;
  photographer?: string;
  layout: "spread" | "journal" | "film";
  keyVisual?: GalleryPhoto;
  photos: GalleryPhoto[];
};

// 首頁主視覺與活動成果共用精選內容；原始相簿不在瀏覽器載入時同步。
export const PUBLIC_ACTIVITY_ALBUMS: PublicActivityAlbum[] = [
  {
    id: "welcome",
    title: "迎新",
    layout: "spread",
    summary: "體育館裡的團隊遊戲，和戶外的互動時刻。",
    sourceUrl: "https://drive.google.com/drive/folders/1Uel7FovTcpeF7bYviHNUfuadrGtKMWeA",
    photos: [
      {
        // 原始檔：DSCF6280.jpg
        id: "welcome-indoor",
        featured: true,
        src: "/images/activities/welcome/indoor-games.webp",
        alt: "迎新時，同學們穿著活動服，在體育館裡一起參與遊戲",
        caption: "一起上場",
        width: 1200,
        height: 800,
      },
      {
        // 原始檔：DSCF6491.jpg
        id: "welcome-team",
        featured: true,
        src: "/images/activities/welcome/team-games.webp",
        alt: "體育館裡，同學們在迎新團隊遊戲中互相合作",
        caption: "團隊互動",
        width: 1200,
        height: 800,
      },
      {
        // 原始檔：DSCF6554.jpg
        id: "welcome-outdoor",
        featured: true,
        src: "/images/activities/welcome/outdoor-games.webp",
        alt: "迎新戶外活動中，同學們圍在桌邊參與遊戲",
        caption: "戶外遊戲",
        width: 1200,
        height: 800,
      },
    ],
  },
];

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, limit = 2000): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function readPhoto(value: unknown): GalleryPhoto | null {
  if (!record(value)) return null;
  const src = safeImageUrl(text(value.src));
  const id = text(value.id, 120);
  if (!id || !src || typeof value.width !== "number" || typeof value.height !== "number"
    || !Number.isFinite(value.width) || !Number.isFinite(value.height)
    || value.width < 1 || value.height < 1 || value.width > 30000 || value.height > 30000) return null;
  return {
    id, src, width: Math.round(value.width), height: Math.round(value.height),
    alt: text(value.alt), caption: text(value.caption),
    photographer: text(value.photographer, 120) || undefined,
    section: text(value.section, 120) || undefined,
    featured: value.featured === true,
  };
}

/** 已設定的空選輯必須保留；只有尚未建立設定時使用迎新素材。 */
export function readActivityAlbums(blocks: Record<string, unknown> | null | undefined): PublicActivityAlbum[] {
  if (blocks === null) return [];
  const config = blocks?.activity_gallery;
  if (config === undefined) return PUBLIC_ACTIVITY_ALBUMS.map((album) => ({
    ...album, photos: album.photos.map((photo) => ({ ...photo })),
  }));
  if (!record(config) || config.version !== 1 || !Array.isArray(config.events)) return [];
  const seen = new Set<string>();
  return config.events.flatMap((value): PublicActivityAlbum[] => {
    if (!record(value)) return [];
    const id = text(value.id, 120);
    const title = text(value.title, 160);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || seen.has(id) || !title) return [];
    seen.add(id);
    const date = text(value.date, 10);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
      && !Number.isNaN(Date.parse(date + "T00:00:00Z"))
      && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;
    const photoIds = new Set<string>();
    const photos = (Array.isArray(value.photos) ? value.photos : []).flatMap((photo) => {
      const parsed = readPhoto(photo);
      if (!parsed || photoIds.has(parsed.id)) return [];
      photoIds.add(parsed.id);
      return [parsed];
    });
    return [{
      id, title, summary: text(value.summary),
      sourceUrl: safeImageUrl(text(value.sourceUrl)),
      date: validDate ? date : undefined,
      photographer: text(value.photographer, 120) || undefined,
      layout: value.layout === "film" || value.layout === "journal" ? value.layout : "spread",
      keyVisual: readPhoto(value.keyVisual) ?? undefined,
      photos,
    }];
  });
}

export function galleryDate(date: string | undefined): string {
  return date ? new Intl.DateTimeFormat("zh-TW", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(date + "T00:00:00Z")) : "";
}

export function gallerySettingsValue(albums: PublicActivityAlbum[]): Record<string, unknown> {
  return { version: 1, events: albums };
}

/** PostgreSQL JSON key order must not produce a false editing conflict. */
export function galleryFingerprint(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (record(item)) return Object.fromEntries(Object.entries(item)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalize(entry)]));
    return item;
  };
  return JSON.stringify(normalize(value ?? null));
}
