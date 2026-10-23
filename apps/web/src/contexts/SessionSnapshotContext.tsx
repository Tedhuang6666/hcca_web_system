"use client";

import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from "react";
import { cacheCurrentUser } from "@/lib/auth-cache";
import type { ServerSessionUser } from "@/lib/server/session";

class SessionSnapshot {
  readonly user: ServerSessionUser;
  initialized = false;

  constructor(user: ServerSessionUser) {
    this.user = user;
  }

  initialize() {
    if (this.initialized) return;
    cacheCurrentUser(this.user);
    this.initialized = true;
  }
}

const SessionSnapshotContext = createContext<SessionSnapshot | null>(null);

/** A per-request snapshot; the shared browser cache is written only after hydration. */
export function SessionSnapshotProvider({ user, children }: {
  user: ServerSessionUser | null;
  children: ReactNode;
}) {
  const snapshot = useMemo(() => user ? new SessionSnapshot(user) : null, [user]);
  useLayoutEffect(() => { snapshot?.initialize(); }, [snapshot]);
  return <SessionSnapshotContext.Provider value={snapshot}>{children}</SessionSnapshotContext.Provider>;
}

export function useSessionSnapshot() {
  return useContext(SessionSnapshotContext);
}
