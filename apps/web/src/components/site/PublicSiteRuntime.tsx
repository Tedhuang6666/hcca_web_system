"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { ModuleStatusProvider } from "@/contexts/ModuleStatusContext";
import { useLiveElection, type ActiveLiveElection } from "./useLiveElection";

const PublicLiveElectionContext = createContext<ActiveLiveElection | null>(null);

function PublicLiveElectionContent({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const activeElection = useLiveElection(25_000, ready);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(() => setReady(true), { timeout: 2_000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(() => setReady(true), 1_000);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <PublicLiveElectionContext.Provider value={activeElection}>
      {children}
    </PublicLiveElectionContext.Provider>
  );
}

export default function PublicSiteRuntime({ children }: { children: React.ReactNode }) {
  return (
    <ModuleStatusProvider authenticated={false}>
      <PublicLiveElectionContent>{children}</PublicLiveElectionContent>
    </ModuleStatusProvider>
  );
}

export function usePublicLiveElection() {
  return useContext(PublicLiveElectionContext);
}
