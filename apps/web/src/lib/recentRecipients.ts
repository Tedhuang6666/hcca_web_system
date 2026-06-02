/**
 * 「最近使用的收件者/簽核人」記錄（純前端 localStorage）。
 * 供新增公文時顯示快選 chips，減少重複搜尋。
 */

export type RecentRecipient = {
  id: string;
  label: string;
};

const KEY = "hcca:recent-recipients:v1";
const LIMIT = 8;

export function getRecentRecipients(limit = LIMIT): RecentRecipient[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as RecentRecipient[];
    if (!Array.isArray(items)) return [];
    return items.slice(0, limit);
  } catch {
    return [];
  }
}

export function pushRecentRecipients(recipients: RecentRecipient[]): void {
  if (typeof window === "undefined") return;
  const valid = recipients.filter((r) => r.id && r.label?.trim());
  if (valid.length === 0) return;
  try {
    const existing = getRecentRecipients(LIMIT);
    // 新選的排前面，依 id 去重。
    const merged: RecentRecipient[] = [...valid];
    for (const item of existing) {
      if (!merged.some((m) => m.id === item.id)) merged.push(item);
    }
    window.localStorage.setItem(KEY, JSON.stringify(merged.slice(0, LIMIT)));
  } catch {
    // 忽略持久化失敗。
  }
}
