"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, systemApi, type ModuleStatusPublic } from "@/lib/api";
import type { ModuleId } from "@/lib/modules";
import { useWS } from "@/hooks/useWS";
import { useLowDataMode } from "@/hooks/useLowDataMode";
import { useResilientPoll } from "@/hooks/useResilientPoll";
import { isFatalApiStatus } from "@/lib/polling";

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

const DEFAULT_POLL_MS = 30_000;
const LOW_DATA_POLL_MS = 300_000;

export function ModuleStatusProvider({ children }: { children: React.ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, ModuleStatusPublic>>({});
  const [wsRoom, setWsRoom] = useState<string | null>(null);
  const lowDataMode = useLowDataMode();

  // 輪詢用：成功回 "ok"，致命狀態（401/522…）回 "stop" 讓輪詢暫停，
  // 其餘暫時性錯誤拋出交給退避；無論結果都不覆蓋既有狀態（維持上一次）。
  const poll = useCallback(async () => {
    try {
      const list = await systemApi.moduleStatuses();
      const map: Record<string, ModuleStatusPublic> = {};
      for (const item of list) map[item.id] = item;
      setStatuses(map);
      return "ok" as const;
    } catch (e) {
      if (e instanceof ApiError && isFatalApiStatus(e.status)) return "stop" as const;
      throw e;
    }
  }, []);

  // 供事件驅動（維護事件、WS 推播）的一次性重抓，靜默吞錯。
  const refresh = useCallback(() => {
    void poll().catch(() => {});
  }, [poll]);

  useResilientPoll(poll, {
    enabled: true,
    intervalMs: lowDataMode ? LOW_DATA_POLL_MS : DEFAULT_POLL_MS,
  });

  useEffect(() => {
    const onNudge = () => refresh();
    window.addEventListener("hcca:module-maintenance", onNudge);
    // 取使用者 ID 訂閱 WebSocket（已登入時才連）
    if (typeof window !== "undefined") {
      const userId = localStorage.getItem("user_id");
      if (userId) setWsRoom(`user:${userId}`);
    }
    return () => {
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
    Boolean(wsRoom) && !lowDataMode,
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
