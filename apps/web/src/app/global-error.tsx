"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { reportClientError } from "@/lib/client-error-reporter";
import RouteErrorState from "@/components/ui/RouteErrorState";

const CHUNK_RELOAD_KEY = "hcca:chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

function isChunkLoadError(error: Error): boolean {
  return /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    `${error.name} ${error.message}`,
  );
}

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    void reportClientError({
      scope: "global-error",
      message: error.message || "Global error",
      stack: error.stack,
      dedupeKey: error.digest ?? error.stack ?? error.message,
    });

    if (isChunkLoadError(error)) {
      try {
        const previousReloadAt = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
        if (!previousReloadAt || Date.now() - previousReloadAt > CHUNK_RELOAD_COOLDOWN_MS) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        // Privacy mode may block sessionStorage; keep the error UI usable.
      }
    }
  }, [error]);

  return (
    <html lang="zh-TW">
      <body>
        <RouteErrorState error={error} reset={() => window.location.reload()} />
      </body>
    </html>
  );
}
