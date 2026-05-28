"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Options<T> = {
  value: T;
  enabled?: boolean;
  debounceMs?: number;
  isEmpty?: (value: T) => boolean;
  save: (value: T) => Promise<unknown>;
};

export function useOnlineAutosave<T>({
  value,
  enabled = true,
  debounceMs = 3500,
  isEmpty,
  save,
}: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readyRef = useRef(false);
  const lastSavedJsonRef = useRef("");
  const valueRef = useRef(value);
  const saveRef = useRef(save);

  valueRef.current = value;
  saveRef.current = save;

  useEffect(() => {
    readyRef.current = false;
    lastSavedJsonRef.current = JSON.stringify(value);
    const timer = window.setTimeout(() => {
      readyRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const saveNow = useCallback(async () => {
    if (!enabled || isEmpty?.(valueRef.current)) return false;
    const nextJson = JSON.stringify(valueRef.current);
    if (nextJson === lastSavedJsonRef.current) return false;

    setStatus("saving");
    setError(null);
    try {
      await saveRef.current(valueRef.current);
      lastSavedJsonRef.current = nextJson;
      const at = new Date().toISOString();
      setLastSavedAt(at);
      setStatus("saved");
      return true;
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "線上儲存失敗");
      return false;
    }
  }, [enabled, isEmpty]);

  useEffect(() => {
    if (!enabled || !readyRef.current) return;
    const timer = window.setTimeout(() => {
      void saveNow();
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [debounceMs, enabled, saveNow, value]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => { void saveNow(); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [enabled, saveNow]);

  return { status, lastSavedAt, error, saveNow };
}
