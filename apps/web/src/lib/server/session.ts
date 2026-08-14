import { cookies } from "next/headers";

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
export async function getServerSession(): Promise<ServerSessionUser | null> {
  const cookieHeader = (await cookies()).toString();
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
}
