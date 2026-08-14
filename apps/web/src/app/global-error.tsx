"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { reportClientError } from "@/lib/client-error-reporter";
import RouteErrorState from "@/components/ui/RouteErrorState";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
    void reportClientError({
      scope: "global-error",
      message: error.message || "Global error",
      stack: error.stack,
      dedupeKey: error.digest ?? error.stack ?? error.message,
    });
  }, [error]);

  return (
    <html lang="zh-TW">
      <body>
        <RouteErrorState error={error} reset={() => window.location.reload()} />
      </body>
    </html>
  );
}
