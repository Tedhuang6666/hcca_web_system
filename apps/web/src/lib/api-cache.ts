/**
 * 模組層級 stale-while-revalidate 快取。
 * 不跨頁重整存活；瀏覽器重整後清空。
 * 用途：讓 useFetch 在切頁回來時立即顯示短時間內的舊資料，背景靜默更新。
 */

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

interface InFlightEntry<T> {
  controller: AbortController;
  consumers: number;
  promise: Promise<T>;
}

const MAX_ENTRIES = 512;
const DEFAULT_TTL_MS = 30_000;
const _cache = new Map<string, CacheEntry>();
const _inFlight = new Map<string, InFlightEntry<unknown>>();

function isExpired(entry: CacheEntry, now = Date.now()): boolean {
  return entry.expiresAt <= now;
}

function purgeExpired(now = Date.now()): void {
  for (const [key, entry] of _cache) {
    if (isExpired(entry, now)) _cache.delete(key);
  }
}

function isMatchingKey(key: string, prefix?: string): boolean {
  return !prefix || key === prefix || key.startsWith(`${prefix}/`);
}

/** 讀快取；過期資料不再回傳，並在每次讀取時清理整個快取的過期項目。 */
export function cacheGet<T>(key: string): T | undefined {
  purgeExpired();
  return _cache.get(key)?.data as T | undefined;
}

/** 寫快取；容量滿時淘汰最早寫入的項目。 */
export function cacheSet(key: string, data: unknown, ttlMs = DEFAULT_TTL_MS): void {
  purgeExpired();
  _cache.delete(key);
  _cache.set(key, {
    data,
    expiresAt: Date.now() + Math.max(1, ttlMs),
  });
  while (_cache.size > MAX_ENTRIES) {
    const oldestKey = _cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    _cache.delete(oldestKey);
  }
}

/** 是否有仍在 TTL 內的快取。 */
export function cacheHas(key: string): boolean {
  return cacheGet(key) !== undefined;
}

/**
 * 以 key 去重同一時間的請求；最後一個使用者離開時取消尚未完成的請求。
 * fetcher 收到的 signal 可直接傳給 fetch/API transport。
 */
export function cacheRequest<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const existing = _inFlight.get(key) as InFlightEntry<T> | undefined;
  if (existing) {
    existing.consumers += 1;
    return withRelease(existing, signal);
  }

  const controller = new AbortController();
  const entry: InFlightEntry<T> = {
    controller,
    consumers: 1,
    promise: Promise.resolve().then(() => fetcher(controller.signal)).finally(() => {
      _inFlight.delete(key);
    }),
  };
  _inFlight.set(key, entry);
  return withRelease(entry, signal);

  function withRelease(current: InFlightEntry<T>, callerSignal?: AbortSignal): Promise<T> {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      current.consumers -= 1;
      if (current.consumers <= 0) current.controller.abort();
    };
    if (callerSignal) {
      if (callerSignal.aborted) release();
      else callerSignal.addEventListener("abort", release, { once: true });
    }
    return current.promise.finally(release);
  }
}

/** 清除快取與同一範圍內尚未完成的請求。 */
export function cachePurge(prefix?: string): void {
  if (!prefix) {
    _cache.clear();
    for (const entry of _inFlight.values()) entry.controller.abort();
    _inFlight.clear();
    return;
  }
  for (const key of _cache.keys()) {
    if (isMatchingKey(key, prefix)) _cache.delete(key);
  }
  for (const [key, entry] of _inFlight) {
    if (isMatchingKey(key, prefix)) {
      entry.controller.abort();
      _inFlight.delete(key);
    }
  }
}
