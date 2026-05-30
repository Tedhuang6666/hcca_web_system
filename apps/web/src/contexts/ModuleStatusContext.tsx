"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { systemApi, type ModuleStatusPublic } from "@/lib/api";
import type { ModuleId } from "@/lib/modules";
import { useWS } from "@/hooks/useWS";

interface ModuleStatusValue {
  statuses: Record<string, ModuleStatusPublic>;
  isModuleDown: (id: ModuleId | null) => boolean;
  moduleInfo: (id: ModuleId | null) => ModuleStatusPublic | null;
  refresh: () => void;
}

const ModuleStatusContext = createContext<ModuleStatusValue>({
  statuses: {},
  isModuleDown: () => false,
  moduleInfo: () => null,
  refresh: () => {},
});

const POLL_MS = 30_000;

export function ModuleStatusProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, ModuleStatusPublic>>({});
  const [wsRoom, setWsRoom] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await systemApi.moduleStatuses();
      const map: Record<string, ModuleStatusPublic> = {};
      for (const item of list) map[item.id] = item;
      setStatuses(map);
    } catch {
      // 公開端點失敗不應影響使用；維持上一次狀態。
    }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, POLL_MS);
    const onNudge = () => refresh();
    window.addEventListener("hcca:module-maintenance", onNudge);
    // 取使用者 ID 訂閱 WebSocket（已登入時才連）
    if (typeof window !== "undefined") {
      const userId = localStorage.getItem("user_id");
      if (userId) setWsRoom(`user:${userId}`);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
      window.removeEventListener("hcca:module-maintenance", onNudge);
    };
  }, [refresh]);

  // 接收後端 broadcast_all 的 module_maintenance 事件，立即重新整理（不等 30s 輪詢）
  useWS(
    wsRoom,
    useCallback(
      (msg) => {
        if (msg.type === "module_maintenance") {
          refresh();
        }
      },
      [refresh],
    ),
    Boolean(wsRoom),
  );

  const isModuleDown = useCallback(
    (id: ModuleId | null) => (id ? Boolean(statuses[id]?.on) : false),
    [statuses],
  );
  const moduleInfo = useCallback(
    (id: ModuleId | null) => (id ? (statuses[id] ?? null) : null),
    [statuses],
  );

  return (
    <ModuleStatusContext.Provider value={{ statuses, isModuleDown, moduleInfo, refresh }}>
      {children}
    </ModuleStatusContext.Provider>
  );
}

export function useModuleStatus() {
  return useContext(ModuleStatusContext);
}
