import { cookies } from "next/headers";
import { cache } from "react";

import { serverApiUrl } from "@/lib/config";
import type { AnnouncementOut } from "@/lib/types";

const SERVER_SESSION_TIMEOUT_MS = 2_000;

export type ServerSessionUser = {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  is_superuser?: boolean;
  is_owner?: boolean;
  permissions: string[];
};

export type ServerImportantAnnouncement = Pick<
  AnnouncementOut,
  "id" | "updated_at" | "link_url" | "title" | "link_label"
>;

/**
 * 在受保護 layout 的 server render 階段驗證 HTTP-only session。
 * 回傳 null 讓 client gate 處理登入導向；不把 access token 暴露給瀏覽器 JSX。
 */
export const getServerSession = cache(async (): Promise<ServerSessionUser | null> => {
  const cookieStore = await cookies();
  // 模擬登入 token 僅存在 sessionStorage，server 無法安全轉送；因此 flag 存在時
  // 不預載原管理員資料，交由既有 client impersonation flow 取得目標使用者資料。
  if (cookieStore.get("hcca_impersonating")?.value === "1") return null;
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SERVER_SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(serverApiUrl("/auth/me"), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as ServerSessionUser;
  } catch {
    // API 短暫不可用時保留頁面輸出，讓瀏覽器端 gate 顯示可恢復的錯誤狀態。
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
});

/**
 * 預先取得登入者可見的重要公告，避免 AppShell hydration 後才插入公告列造成 CLS。
 * 僅把橫幅真正使用的欄位傳給 client，避免把公告內文帶進 RSC payload。
 */
export const getServerImportantAnnouncement = cache(
  async (): Promise<ServerImportantAnnouncement | null | undefined> => {
    const cookieHeader = (await cookies()).toString();
    if (!cookieHeader) return undefined;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERVER_SESSION_TIMEOUT_MS);
    try {
      const response = await fetch(serverApiUrl("/announcements/active-urgent"), {
        headers: { cookie: cookieHeader },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const item = (await response.json()) as AnnouncementOut | null;
      if (!item) return null;
      return {
        id: item.id,
        updated_at: item.updated_at,
        link_url: item.link_url,
        title: item.title,
        link_label: item.link_label,
      };
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeoutId);
    }
  },
);
