import { apiUrl } from "../config";
import { csrfHeaders } from "./transport";

export type RefreshStatus = "ok" | "invalid" | "unavailable";

let refreshPromise: Promise<RefreshStatus> | null = null;
const AUTH_REFRESH_TIMEOUT_MS = 8_000;
const AUTH_REFRESH_LOCK_NAME = "hcca-auth-refresh";
const AUTH_REFRESH_LOCK_KEY = "hcca:auth-refresh-lock";
const AUTH_REFRESH_STATE_KEY = "hcca:auth-refresh-state";
const AUTH_REFRESH_LOCK_TTL_MS = AUTH_REFRESH_TIMEOUT_MS + 2_000;
const AUTH_REFRESH_WAIT_TIMEOUT_MS = AUTH_REFRESH_TIMEOUT_MS + 3_000;
const AUTH_REFRESH_STATE_TTL_MS = 15_000;
type RefreshState = { completedAt: number; status: RefreshStatus };
type RefreshLock = { owner: string; expiresAt: number };
const refreshOwner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function refreshOnce(): Promise<RefreshStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REFRESH_TIMEOUT_MS);
  return fetch(apiUrl("/auth/refresh"), {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders("POST"),
    signal: controller.signal,
  })
    .then((response): RefreshStatus => response.ok ? "ok" : response.status >= 500 ? "unavailable" : "invalid")
    .catch((): RefreshStatus => "unavailable")
    .finally(() => clearTimeout(timeout));
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function readRefreshState(): RefreshState | null {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(AUTH_REFRESH_STATE_KEY) ?? "null") as Partial<RefreshState>;
    if (typeof value.completedAt !== "number" || !Number.isFinite(value.completedAt) || !["ok", "invalid", "unavailable"].includes(value.status ?? "")) return null;
    return { completedAt: value.completedAt, status: value.status as RefreshStatus };
  } catch {
    return null;
  }
}

function writeRefreshState(status: RefreshStatus): void {
  try {
    browserStorage()?.setItem(AUTH_REFRESH_STATE_KEY, JSON.stringify({ completedAt: Date.now(), status }));
  } catch {
    // Storage 失效時仍有同 tab promise lock 保護。
  }
}

function recentRefreshSince(observedAt: number): RefreshStatus | null {
  const state = readRefreshState();
  return state && state.completedAt > observedAt && Date.now() - state.completedAt <= AUTH_REFRESH_STATE_TTL_MS
    ? state.status
    : null;
}

async function refreshWithNavigatorLock(observedAt: number): Promise<RefreshStatus | null> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REFRESH_WAIT_TIMEOUT_MS);
  try {
    return await navigator.locks.request(AUTH_REFRESH_LOCK_NAME, { signal: controller.signal }, async () => {
      const recent = recentRefreshSince(observedAt);
      if (recent) return recent;
      const status = await refreshOnce();
      writeRefreshState(status);
      return status;
    });
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

function readRefreshLock(): RefreshLock | null {
  try {
    const value = JSON.parse(browserStorage()?.getItem(AUTH_REFRESH_LOCK_KEY) ?? "null") as Partial<RefreshLock>;
    return typeof value.owner === "string" && typeof value.expiresAt === "number" ? value as RefreshLock : null;
  } catch {
    return null;
  }
}

function tryAcquireRefreshLock(): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  const now = Date.now();
  const current = readRefreshLock();
  if (current && current.owner !== refreshOwner && current.expiresAt > now) return false;
  try {
    storage.setItem(AUTH_REFRESH_LOCK_KEY, JSON.stringify({ owner: refreshOwner, expiresAt: now + AUTH_REFRESH_LOCK_TTL_MS }));
    return readRefreshLock()?.owner === refreshOwner;
  } catch {
    return false;
  }
}

function releaseRefreshLock(): void {
  const storage = browserStorage();
  if (!storage || readRefreshLock()?.owner !== refreshOwner) return;
  try { storage.removeItem(AUTH_REFRESH_LOCK_KEY); } catch { /* safety TTL handles cleanup */ }
}

async function refreshWithStorageLock(observedAt: number): Promise<RefreshStatus> {
  if (!browserStorage()) return refreshOnce();
  const deadline = Date.now() + AUTH_REFRESH_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (tryAcquireRefreshLock()) {
      try {
        const recent = recentRefreshSince(observedAt);
        if (recent) return recent;
        const status = await refreshOnce();
        writeRefreshState(status);
        return status;
      } finally {
        releaseRefreshLock();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return "unavailable";
}

export async function refreshWithStatus(): Promise<RefreshStatus> {
  if (refreshPromise) return refreshPromise;
  const observedAt = readRefreshState()?.completedAt ?? 0;
  refreshPromise = (async () => {
    const lockedStatus = await refreshWithNavigatorLock(observedAt);
    return lockedStatus ?? refreshWithStorageLock(observedAt);
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export async function silentRefresh(): Promise<boolean> {
  return (await refreshWithStatus()) === "ok";
}
