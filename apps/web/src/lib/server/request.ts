import { cookies } from "next/headers";

import { serverApiUrl } from "@/lib/config";

export type PublicServerDataPolicy = {
  scope: "public";
  revalidate?: number;
};

export type PrivateServerDataPolicy = {
  scope: "private";
};

export type ServerDataPolicy = PublicServerDataPolicy | PrivateServerDataPolicy;

export const publicServerData = (revalidate = 60): PublicServerDataPolicy => ({
  scope: "public",
  revalidate,
});

export const privateServerData: PrivateServerDataPolicy = { scope: "private" };

export class ServerRequestError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(`伺服器資料請求失敗（${status}）：${path}`);
  }
}

/**
 * Server Component 專用 API client。
 * 公開回應可使用 ISR；私有請求只轉送 HTTP-only cookie，且永不進共享快取。
 */
export async function serverRequest<T>(
  path: string,
  policy: ServerDataPolicy,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  const cacheOptions = policy.scope === "public"
    ? { next: { revalidate: policy.revalidate ?? 60 } }
    : { cache: "no-store" as const };

  if (policy.scope === "private") {
    const cookieStore = await cookies();
    // Impersonation tokens live only in sessionStorage and must never cause the
    // server to render the actor's cookie-backed data during a client switch.
    if (cookieStore.get("hcca_impersonating")?.value === "1") {
      throw new ServerRequestError(409, path);
    }
    const cookieHeader = cookieStore.toString();
    if (cookieHeader) headers.set("cookie", cookieHeader);
  }

  const response = await fetch(serverApiUrl(path), {
    ...init,
    ...cacheOptions,
    headers,
  });
  if (!response.ok) throw new ServerRequestError(response.status, path);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
