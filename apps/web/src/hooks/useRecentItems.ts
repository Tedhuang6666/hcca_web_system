"use client";

import { useEffect, useState } from "react";
import { getRecents, type RecentItem } from "@/lib/recents";

/**
 * 讀取「最近開啟」清單，並在跨分頁（storage 事件）或同分頁
 * （hcca:recents-changed 自訂事件）更新時自動刷新。
 */
export function useRecentItems(limit?: number): RecentItem[] {
  const [items, setItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    const refresh = () => setItems(getRecents(limit));
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("hcca:recents-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("hcca:recents-changed", refresh);
    };
  }, [limit]);

  return items;
}
