import { cookies } from "next/headers";
import { cache } from "react";

import { serverApiUrl } from "@/lib/config";

export type ServerSessionUser = {
  id: string;
  display_name: string;
  email: string;
  avatar_url?: string | null;
  is_superuser?: boolean;
  is_owner?: boolean;
  permissions: string[];
};

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

  try {
    const response = await fetch(serverApiUrl("/auth/me"), {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as ServerSessionUser;
  } catch {
    // API 短暫不可用時保留頁面輸出，讓瀏覽器端 gate 顯示可恢復的錯誤狀態。
    return null;
  }
});
