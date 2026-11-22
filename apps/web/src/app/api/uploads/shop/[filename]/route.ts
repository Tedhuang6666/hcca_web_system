import { serverApiUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

// Only the existing public shop image namespace may bypass the build-time API rewrite.
const IMAGE_FILENAME = /^[a-zA-Z0-9_-]+\.(?:avif|gif|jpe?g|png|webp)$/i;

function unavailable(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** Next Image resolves local sources through Next, rather than through Caddy. */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/uploads/shop/[filename]">,
): Promise<Response> {
  const { filename } = await context.params;
  if (!IMAGE_FILENAME.test(filename)) return unavailable(404);

  let upstream: Response;
  try {
    upstream = await fetch(serverApiUrl(`/uploads/shop/${encodeURIComponent(filename)}`), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return unavailable(503);
  }

  if (!upstream.ok) {
    await upstream.body?.cancel();
    return unavailable(upstream.status === 404 ? 404 : 502);
  }
  const contentType = upstream.headers.get("Content-Type") ?? "";
  if (!/^image\/(?:avif|gif|jpeg|png|webp)(?:;|$)/i.test(contentType)) {
    await upstream.body?.cancel();
    return unavailable(502);
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": upstream.headers.get("Cache-Control") ?? "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
