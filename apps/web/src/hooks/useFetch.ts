"use client";
import { useEffect, useRef, useState } from "react";
import { apiErrorMessage } from "@/lib/api-helpers";
import { cacheGet, cacheHas, cacheRequest, cacheSet } from "@/lib/api-cache";

function showFetchErrorToast(message: string) {
  void import("sonner").then(({ toast }) => toast.error(message));
}

// ── 不帶 cacheKey 的原始多載（向後相容） ──────────────────────────────────────
type Fetcher<T> = (signal?: AbortSignal) => Promise<T>;

export function useFetch<T>(fetcher: Fetcher<T>, deps: unknown[], errorFallback: string): [T | undefined, boolean];
export function useFetch<T>(fetcher: Fetcher<T>, deps: unknown[], errorFallback: string, initialValue: T): [T, boolean];
// ── 帶 cacheKey：stale-while-revalidate ─────────────────────────────────────
export function useFetch<T>(fetcher: Fetcher<T>, deps: unknown[], errorFallback: string, initialValue: T, cacheKey: string): [T, boolean];
export function useFetch<T>(fetcher: Fetcher<T>, deps: unknown[], errorFallback: string, initialValue: T, cacheKey: string, skipInitialFetch: boolean): [T, boolean];
export function useFetch<T>(fetcher: Fetcher<T>, deps: unknown[], errorFallback: string, initialValue?: T, cacheKey?: string, skipInitialFetch?: boolean): [T | undefined, boolean];

export function useFetch<T>(
  fetcher: Fetcher<T>,
  deps: unknown[],
  errorFallback: string,
  initialValue?: T,
  cacheKey?: string,
  skipInitialFetch = false,
): [T | undefined, boolean] {
  // 若有 cacheKey，以 deps 加入 key（同一頁面不同篩選條件各自快取）
  const resolvedKey = cacheKey
    ? deps.length > 0 ? `${cacheKey}/${JSON.stringify(deps)}` : cacheKey
    : null;

  const hasCached = resolvedKey ? cacheHas(resolvedKey) : false;
  const cachedValue = resolvedKey ? cacheGet<T>(resolvedKey) : undefined;

  const [data, setData] = useState<T | undefined>(() => {
    if (hasCached && cachedValue !== undefined) return cachedValue;
    return initialValue;
  });
  // 有快取時跳過 loading，直接顯示舊資料；背景靜默更新
  const [loading, setLoading] = useState(!hasCached && !skipInitialFetch);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorRef = useRef(errorFallback);
  errorRef.current = errorFallback;
  const keyRef = useRef(resolvedKey);
  keyRef.current = resolvedKey;
  const skipInitialFetchRef = useRef(skipInitialFetch);

  useEffect(() => {
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    // 有快取時只靜默背景更新，不顯示 loading
    const isStale = resolvedKey ? !cacheHas(resolvedKey) : true;
    if (isStale) setLoading(true);

    const request = resolvedKey
      ? cacheRequest(resolvedKey, (signal) => fetcherRef.current(signal), controller.signal)
      : fetcherRef.current(controller.signal);

    request
      .then((result) => {
        if (!cancelled) {
          setData(result);
          if (keyRef.current) cacheSet(keyRef.current, result);
        }
      })
      .catch((e) => {
        if (!cancelled) showFetchErrorToast(apiErrorMessage(e, errorRef.current));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [data, loading];
}
