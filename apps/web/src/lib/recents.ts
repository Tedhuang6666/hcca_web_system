/**
 * 「最近開啟」記錄（純前端 localStorage，免後端/migration）。
 * 供 CommandMenu 與 Dashboard 顯示個人化捷徑。
 */

export type RecentKind =
  | "document"
  | "regulation"
  | "survey"
  | "meeting"
  | "announcement";

export type RecentItem = {
  kind: RecentKind;
  id: string;
  title: string;
  href: string;
  ts: number;
};

const KEY = "hcca:recents:v1";
const LIMIT = 12;

export function getRecents(limit = LIMIT): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as RecentItem[];
    if (!Array.isArray(items)) return [];
    return items.slice(0, limit);
  } catch {
    return [];
  }
}

export function recordRecent(item: Omit<RecentItem, "ts">): void {
  if (typeof window === "undefined") return;
  if (!item.id || !item.title?.trim()) return;
  try {
    const existing = getRecents(LIMIT);
    const deduped = existing.filter(
      (it) => !(it.kind === item.kind && it.id === item.id),
    );
    const next: RecentItem[] = [{ ...item, ts: Date.now() }, ...deduped].slice(
      0,
      LIMIT,
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
    // 同分頁的 hook 不會收到 storage 事件，主動派發讓 useRecentItems 更新。
    window.dispatchEvent(new Event("hcca:recents-changed"));
  } catch {
    // 忽略持久化失敗。
  }
}
