"use client";
import { useCallback, useState } from "react";
import { ApiError, notificationsApi, tasksApi } from "@/lib/api";
import { isFatalApiStatus } from "@/lib/polling";
import { useResilientPoll } from "@/hooks/useResilientPoll";
import { useLowDataMode } from "@/hooks/useLowDataMode";

const BASE_POLL_MS = 60_000;
const LOW_DATA_POLL_MS = 300_000;

/**
 * 共用的「待辦 + 未讀通知」計數輪詢，供 Topbar 與 BottomTabBar 使用。
 *
 * 重點：
 *  - `enabled` 為 false（未登入／身分尚未解析）時完全不發請求。
 *  - 命中致命狀態（401/403/522…）會停止輪詢，待使用者回到頁面或網路恢復再續。
 *  - 省流模式拉長輪詢間隔。
 *
 * 回傳的 setter 供 WebSocket 推播或使用者操作做樂觀更新。
 */
export function useInboxCounts(enabled: boolean) {
  const [taskCount, setTaskCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const lowDataMode = useLowDataMode();

  const poll = useCallback(async () => {
    try {
      const [inbox, { unread }] = await Promise.all([
        tasksApi.list(),
        notificationsApi.count(),
      ]);
      setTaskCount(inbox.total);
      setUnreadCount(unread);
      return "ok" as const;
    } catch (e) {
      if (e instanceof ApiError && isFatalApiStatus(e.status)) return "stop" as const;
      throw e; // 暫時性錯誤 → 交給輪詢做退避
    }
  }, []);

  useResilientPoll(poll, {
    enabled,
    intervalMs: lowDataMode ? LOW_DATA_POLL_MS : BASE_POLL_MS,
  });

  // 供事件驅動（WS、開啟通知面板）的一次性重抓，靜默吞錯。
  const refresh = useCallback(() => {
    void poll().catch(() => {});
  }, [poll]);

  return { taskCount, unreadCount, setTaskCount, setUnreadCount, refresh };
}
