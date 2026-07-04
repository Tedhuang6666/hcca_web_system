/**
 * 模組層級 stale-while-revalidate 快取。
 * 不跨頁重整存活；瀏覽器重整後清空。
 * 用途：讓 useFetch 在切頁回來時立即顯示舊資料，背景靜默更新。
 */

interface CacheEntry {
  data: unknown;
  at: number;
}

const _cache = new Map<string, CacheEntry>();

/** 讀快取；不檢查 TTL，由呼叫端判斷是否陳舊。 */
export function cacheGet<T>(key: string): T | undefined {
  return _cache.get(key)?.data as T | undefined;
}

/** 寫快取。ttlMs 目前保留給呼叫端語意標示，讀取仍由呼叫端決定是否陳舊。 */
export function cacheSet(key: string, data: unknown, ttlMs?: number): void {
  void ttlMs;
  _cache.set(key, { data, at: Date.now() });
}

/** 是否有快取（不論新舊）。 */
export function cacheHas(key: string): boolean {
  return _cache.has(key);
}

/**
 * 清除快取。
 * - 不傳 prefix：清全部
 * - 傳 prefix：刪所有以 `prefix` 開頭的鍵（含 exact match）
 */
export function cachePurge(prefix?: string): void {
  if (!prefix) { _cache.clear(); return; }
  for (const k of _cache.keys()) {
    if (k === prefix || k.startsWith(prefix + "/")) _cache.delete(k);
  }
}
