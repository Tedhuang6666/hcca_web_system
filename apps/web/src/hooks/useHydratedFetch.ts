"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Fetcher<T> = (signal?: AbortSignal) => Promise<T>;

type HydratedFetchOptions<T> = {
  initialData: T;
  deps: readonly unknown[];
  staleAfterMs?: number;
};

/**
 * 使用 Server Component 提供的首屏資料，避免 hydration 後重複請求同一份 GET。
 * 首次更新會在篩選條件改變、手動 refresh，或頁面恢復焦點且資料過期時發生。
 */
export function useHydratedFetch<T>(
  fetcher: Fetcher<T>,
  { initialData, deps, staleAfterMs = 30_000 }: HydratedFetchOptions<T>,
): { data: T; loading: boolean; refresh: () => Promise<void> } {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const fetcherRef = useRef(fetcher);
  const loadedAt = useRef(Date.now());
  const initialDeps = useRef(JSON.stringify(deps));
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    const controller = new AbortController();
    setLoading(true);
    try {
      const result = await fetcherRef.current(controller.signal);
      setData(result);
      loadedAt.current = Date.now();
    } finally {
      setLoading(false);
    }
  }, []);

  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    if (depsKey !== initialDeps.current) void refresh();
  }, [depsKey, refresh]);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current >= staleAfterMs) {
        void refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, staleAfterMs]);

  return { data, loading, refresh };
}
