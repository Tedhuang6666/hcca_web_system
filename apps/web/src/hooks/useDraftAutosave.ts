"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DRAFT_PREFIX = "hcca:draft:v1:";
const FILE_DB_NAME = "hcca-draft-files";
const FILE_DB_VERSION = 1;
const FILE_STORE_NAME = "draftFiles";

type StoredDraft<T> = {
  value: T;
  updatedAt: string;
};

type RestoreMeta = {
  updatedAt: string;
};

type DraftAutosaveOptions<T> = {
  key: string;
  value: T;
  onRestore: (value: T, meta: RestoreMeta) => void;
  enabled?: boolean;
  debounceMs?: number;
  isEmpty?: (value: T) => boolean;
};

type FileDraft = {
  key: string;
  files: File[];
  updatedAt: string;
};

type FileDraftAutosaveOptions = {
  key: string;
  files: File[];
  onRestore: (files: File[], meta: RestoreMeta) => void;
  enabled?: boolean;
  debounceMs?: number;
};

const buildKey = (key: string) => `${DRAFT_PREFIX}${key}`;

function readStoredDraft<T>(key: string): StoredDraft<T> | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(buildKey(key));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.updatedAt !== "string" || !("value" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredDraft(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(buildKey(key));
}

export function useDraftAutosave<T>({
  key,
  value,
  onRestore,
  enabled = true,
  debounceMs = 700,
  isEmpty,
}: DraftAutosaveOptions<T>) {
  const [ready, setReady] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  valueRef.current = value;

  const saveNow = useCallback(() => {
    if (!enabled || typeof window === "undefined") return;
    if (isEmpty?.(valueRef.current)) {
      clearStoredDraft(key);
      setLastSavedAt(null);
      return;
    }

    const updatedAt = new Date().toISOString();
    const payload: StoredDraft<T> = { value: valueRef.current, updatedAt };
    window.localStorage.setItem(buildKey(key), JSON.stringify(payload));
    setLastSavedAt(updatedAt);
  }, [enabled, isEmpty, key]);

  const clearDraft = useCallback(() => {
    clearStoredDraft(key);
    setLastSavedAt(null);
  }, [key]);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }

    const stored = readStoredDraft<T>(key);
    if (stored && !isEmpty?.(stored.value)) {
      onRestore(stored.value, { updatedAt: stored.updatedAt });
      setLastSavedAt(stored.updatedAt);
    }
    setReady(true);
  }, [enabled, isEmpty, key, onRestore]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(saveNow, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [debounceMs, enabled, ready, saveNow, value]);

  useEffect(() => {
    if (!enabled || !ready) return;

    const flush = () => saveNow();
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [enabled, ready, saveNow]);

  return { clearDraft, flushDraft: saveNow, lastSavedAt };
}

function openFileDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB_NAME, FILE_DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILE_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function writeFileDraft(key: string, files: File[]) {
  if (typeof window === "undefined" || !("indexedDB" in window)) return;

  const db = await openFileDraftDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILE_STORE_NAME, "readwrite");
      const store = tx.objectStore(FILE_STORE_NAME);
      if (files.length === 0) {
        store.delete(key);
      } else {
        store.put({ key, files, updatedAt: new Date().toISOString() } satisfies FileDraft);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function readFileDraft(key: string): Promise<FileDraft | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;

  const db = await openFileDraftDb();
  try {
    return await new Promise<FileDraft | null>((resolve, reject) => {
      const tx = db.transaction(FILE_STORE_NAME, "readonly");
      const request = tx.objectStore(FILE_STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as FileDraft | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function clearStoredFileDraft(key: string) {
  await writeFileDraft(key, []);
}

export function useFileDraftAutosave({
  key,
  files,
  onRestore,
  enabled = true,
  debounceMs = 700,
}: FileDraftAutosaveOptions) {
  const [ready, setReady] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filesRef = useRef(files);

  filesRef.current = files;

  const saveNow = useCallback(() => {
    if (!enabled) return;
    void writeFileDraft(key, filesRef.current);
  }, [enabled, key]);

  const clearDraftFiles = useCallback(() => {
    void clearStoredFileDraft(key);
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    if (!enabled) return;

    readFileDraft(key)
      .then((stored) => {
        if (cancelled || !stored || stored.files.length === 0) return;
        onRestore(stored.files, { updatedAt: stored.updatedAt });
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, key, onRestore]);

  useEffect(() => {
    if (!enabled || !ready) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(saveNow, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [debounceMs, enabled, files, ready, saveNow]);

  return { clearDraftFiles, flushDraftFiles: saveNow };
}
