"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AUTH_CACHE_EVENT, getAuthItem } from "@/lib/auth-cache";

const DRAFT_PREFIX = "hcca:draft:v1:";
const FILE_DB_NAME = "hcca-draft-files";
const FILE_DB_VERSION = 1;
const FILE_STORE_NAME = "draftFiles";
const ANONYMOUS_SCOPE_KEY = "hcca:draft:anonymous-scope";

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

function getOwnerScope(): string | null {
  if (typeof window === "undefined") return null;

  // This ID only separates browser drafts between accounts; the server remains the
  // authority for identity and access.
  const userId = getAuthItem("user_id");
  if (userId) return `user:${userId}`;

  try {
    let anonymousId = window.sessionStorage.getItem(ANONYMOUS_SCOPE_KEY);
    if (!anonymousId) {
      anonymousId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
      window.sessionStorage.setItem(ANONYMOUS_SCOPE_KEY, anonymousId);
    }
    return `anonymous:${anonymousId}`;
  } catch {
    return null;
  }
}

function useDraftOwnerScope(): string | null {
  const [scope, setScope] = useState<string | null>(null);

  useEffect(() => {
    const updateScope = () => setScope(getOwnerScope());
    const onStorage = (event: StorageEvent) => {
      if (event.key === "user_id") updateScope();
    };

    updateScope();
    window.addEventListener(AUTH_CACHE_EVENT, updateScope);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_CACHE_EVENT, updateScope);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return scope;
}

function scopeDraftKey(key: string, scope: string | null): string | null {
  return scope ? `${scope}:${key}` : null;
}

function valueSignature(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return String(value);
  }
}

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
  const scopedKey = scopeDraftKey(key, getOwnerScope());
  if (scopedKey) window.localStorage.removeItem(buildKey(scopedKey));
}

export function useDraftAutosave<T>({
  key,
  value,
  onRestore,
  enabled = true,
  debounceMs = 700,
  isEmpty,
}: DraftAutosaveOptions<T>) {
  const ownerScope = useDraftOwnerScope();
  const scopedKey = scopeDraftKey(key, ownerScope);
  const [ready, setReady] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const loadedKeyRef = useRef<string | null>(null);
  const previousKeyRef = useRef(scopedKey);
  const blockedValueSignatureRef = useRef<string | null>(null);

  valueRef.current = value;
  if (previousKeyRef.current !== scopedKey) {
    previousKeyRef.current = scopedKey;
    blockedValueSignatureRef.current = valueSignature(value);
  }

  const saveNow = useCallback(() => {
    if (
      !enabled
      || typeof window === "undefined"
      || !scopedKey
      || loadedKeyRef.current !== scopedKey
      || scopeDraftKey(key, getOwnerScope()) !== scopedKey
    ) return;
    const currentSignature = valueSignature(valueRef.current);
    if (blockedValueSignatureRef.current === currentSignature) return;
    blockedValueSignatureRef.current = null;
    if (isEmpty?.(valueRef.current)) {
      window.localStorage.removeItem(buildKey(scopedKey));
      setLastSavedAt(null);
      return;
    }

    const updatedAt = new Date().toISOString();
    const payload: StoredDraft<T> = { value: valueRef.current, updatedAt };
    window.localStorage.setItem(buildKey(scopedKey), JSON.stringify(payload));
    setLastSavedAt(updatedAt);
  }, [enabled, isEmpty, key, scopedKey]);

  const clearDraft = useCallback(() => {
    if (!scopedKey || scopeDraftKey(key, getOwnerScope()) !== scopedKey) return;
    window.localStorage.removeItem(buildKey(scopedKey));
    setLastSavedAt(null);
  }, [key, scopedKey]);

  useEffect(() => {
    loadedKeyRef.current = null;
    setReady(false);
    setLastSavedAt(null);
    if (!enabled || !scopedKey) {
      return;
    }

    const stored = readStoredDraft<T>(scopedKey);
    if (stored && !isEmpty?.(stored.value)) {
      onRestore(stored.value, { updatedAt: stored.updatedAt });
      setLastSavedAt(stored.updatedAt);
    }
    loadedKeyRef.current = scopedKey;
    setReady(true);
  }, [enabled, isEmpty, onRestore, scopedKey]);

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
  const ownerScope = useDraftOwnerScope();
  const scopedKey = scopeDraftKey(key, ownerScope);
  const [ready, setReady] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filesRef = useRef(files);
  const loadedKeyRef = useRef<string | null>(null);
  const previousKeyRef = useRef(scopedKey);
  const blockedFilesRef = useRef<File[] | null>(null);

  filesRef.current = files;
  if (previousKeyRef.current !== scopedKey) {
    previousKeyRef.current = scopedKey;
    blockedFilesRef.current = files;
  }

  const saveNow = useCallback(() => {
    if (
      !enabled
      || !scopedKey
      || loadedKeyRef.current !== scopedKey
      || scopeDraftKey(key, getOwnerScope()) !== scopedKey
    ) return;
    if (blockedFilesRef.current === filesRef.current) return;
    blockedFilesRef.current = null;
    void writeFileDraft(scopedKey, filesRef.current);
  }, [enabled, key, scopedKey]);

  const clearDraftFiles = useCallback(() => {
    if (!scopedKey || scopeDraftKey(key, getOwnerScope()) !== scopedKey) return;
    void clearStoredFileDraft(scopedKey);
  }, [key, scopedKey]);

  useEffect(() => {
    let cancelled = false;
    loadedKeyRef.current = null;
    setReady(false);
    if (!enabled || !scopedKey) return;

    readFileDraft(scopedKey)
      .then((stored) => {
        if (cancelled || !stored || stored.files.length === 0) return;
        onRestore(stored.files, { updatedAt: stored.updatedAt });
      })
      .finally(() => {
        if (!cancelled) {
          loadedKeyRef.current = scopedKey;
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, onRestore, scopedKey]);

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
