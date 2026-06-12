"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/api-helpers";

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], errorFallback: string): [T | undefined, boolean];
export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[], errorFallback: string, initialValue: T): [T, boolean];
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  errorFallback: string,
  initialValue?: T,
): [T | undefined, boolean] {
  const [data, setData] = useState<T | undefined>(initialValue);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const errorRef = useRef(errorFallback);
  errorRef.current = errorFallback;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef.current()
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) toast.error(apiErrorMessage(e, errorRef.current)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [data, loading];
}
