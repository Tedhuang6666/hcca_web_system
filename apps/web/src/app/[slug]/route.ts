import { NextResponse } from "next/server";
import { serverApiUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

async function resolveShortLink(slug: string): Promise<Response> {
  let lookup: Response;
  try {
    lookup = await fetch(
      serverApiUrl(`/short-links/resolve/${encodeURIComponent(slug)}`),
      { cache: "no-store", signal: AbortSignal.timeout(5_000) },
    );
  } catch {
    return new Response("短網址服務暫時無法使用，請稍後重試。", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "5",
      },
    });
  }

  if (lookup.status === 404) {
    return new Response("找不到這個班聯短網址。", {
      status: 404,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (!lookup.ok) {
    return new Response("短網址服務暫時無法使用，請稍後重試。", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "5",
      },
    });
  }

  try {
    const result = await lookup.json() as { target_url?: unknown };
    if (typeof result.target_url !== "string") throw new Error("Missing target URL");
    const target = new URL(result.target_url);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("Unsupported redirect protocol");
    }
    const response = NextResponse.redirect(target, 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return new Response("短網址目的地資料無效。", {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

export async function GET(_request: Request, context: RouteContext<"/[slug]">): Promise<Response> {
  const { slug } = await context.params;
  return resolveShortLink(slug);
}

export async function HEAD(_request: Request, context: RouteContext<"/[slug]">): Promise<Response> {
  const response = await resolveShortLink((await context.params).slug);
  return new Response(null, { status: response.status, headers: response.headers });
}
