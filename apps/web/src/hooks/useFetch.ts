"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-helpers";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";

// ── 不帶 cacheKey 的原始多載（向後相容） ──────────────────────────────────────
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], errorFallback: string): [T | undefined, boolean];
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], errorFallback: string, initialValue: T): [T, boolean];
// ── 帶 cacheKey：stale-while-revalidate ─────────────────────────────────────
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], errorFallback: string, initialValue: T, cacheKey: string): [T, boolean];
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], errorFallback: string, initialValue?: T, cacheKey?: string): [T | undefined, boolean];

export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  errorFallback: string,
  initialValue?: T,
  cacheKey?: string,
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
  const [loading, setLoading] = useState(!hasCached);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorRef = useRef(errorFallback);
  errorRef.current = errorFallback;
  const keyRef = useRef(resolvedKey);
  keyRef.current = resolvedKey;

  useEffect(() => {
    let cancelled = false;

    // 有快取時只靜默背景更新，不顯示 loading
    const isStale = resolvedKey ? !cacheHas(resolvedKey) : true;
    if (isStale) setLoading(true);

    fetcherRef.current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          if (keyRef.current) cacheSet(keyRef.current, result);
        }
      })
      .catch((e) => {
        if (!cancelled) toast.error(apiErrorMessage(e, errorRef.current));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [data, loading];
}
