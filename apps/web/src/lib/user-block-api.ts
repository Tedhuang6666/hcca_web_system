import type { DefenseRule } from "@/lib/api";
import { apiUrl } from "@/lib/config";

export interface UserBlockPreview {
  user_id: string;
  email: string;
  display_name: string;
  emails: string[];
  ips: string[];
}

export interface UserBlockResult extends UserBlockPreview {
  rules: DefenseRule[];
  revoked_count: number;
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const value = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("csrf_token="))
    ?.slice("csrf_token=".length);
  return value ? { "X-CSRF-Token": decodeURIComponent(value) } : {};
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let message = "請求失敗";
  try {
    const payload = (await response.json()) as { detail?: string };
    if (typeof payload.detail === "string") message = payload.detail;
  } catch {
    // 非 JSON 回應使用預設訊息。
  }
  throw new Error(message);
}

export async function previewUserBlock(identifier: string): Promise<UserBlockPreview> {
  const response = await fetch(
    apiUrl(`/admin/system/defense/users/${encodeURIComponent(identifier)}`),
    { credentials: "include", cache: "no-store" },
  );
  return readJson<UserBlockPreview>(response);
}

export async function blockUserAccount(body: {
  identifier: string;
  reason: string;
  expires_at?: string | null;
  include_emails?: boolean;
  include_ips?: boolean;
}): Promise<UserBlockResult> {
  const response = await fetch(apiUrl("/admin/system/defense/user-blocks"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeader(),
    },
    body: JSON.stringify(body),
  });
  return readJson<UserBlockResult>(response);
}
