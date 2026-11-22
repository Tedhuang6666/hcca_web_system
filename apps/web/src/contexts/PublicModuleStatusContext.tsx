"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { ModuleStatusPublic } from "@/lib/api/system";
import { apiUrl } from "@/lib/config";
import type { ModuleId } from "@/lib/modules";

type PublicModuleStatusValue = {
  statuses: Record<string, ModuleStatusPublic>;
  isModuleDown: (id: ModuleId | null) => boolean;
};

const PublicModuleStatusContext = createContext<PublicModuleStatusValue>({
  statuses: {},
  isModuleDown: () => false,
});

function toStatusMap(items: ModuleStatusPublic[]): Record<string, ModuleStatusPublic> {
  const map: Record<string, ModuleStatusPublic> = {};
  for (const item of items) map[item.id] = item;
  return map;
}

export default function PublicModuleStatusProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, ModuleStatusPublic>>({});

  useEffect(() => {
    let active = true;
    let loaded = false;
    let idleId: number | undefined;

    const load = () => {
      if (!active || loaded) return;
      loaded = true;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1_500);

      void fetch(apiUrl("/system/module-status"), {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const items = (await response.json()) as ModuleStatusPublic[];
          if (active && Array.isArray(items)) setStatuses(toStatusMap(items));
        })
        .catch(() => undefined)
        .finally(() => window.clearTimeout(timeoutId));
    };

    const timeoutId = window.setTimeout(load, 2_000);
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(() => {
        window.clearTimeout(timeoutId);
        load();
      }, { timeout: 2_500 });
    }

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
    };
  }, []);

  const isModuleDown = useCallback(
    (id: ModuleId | null) => (id ? Boolean(statuses[id]?.on) : false),
    [statuses],
  );
  const value = useMemo(() => ({ statuses, isModuleDown }), [isModuleDown, statuses]);

  return (
    <PublicModuleStatusContext.Provider value={value}>
      {children}
    </PublicModuleStatusContext.Provider>
  );
}

export function usePublicModuleStatus() {
  return useContext(PublicModuleStatusContext);
}
