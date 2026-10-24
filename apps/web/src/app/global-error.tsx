"use client";

import { useEffect } from "react";

import RouteErrorState from "@/components/ui/RouteErrorState";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    void import("@sentry/nextjs")
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => undefined);
  }, [error]);

  return (
    <html lang="zh-TW">
      <body>
        <RouteErrorState error={error} reset={() => window.location.reload()} scope="global-error" />
      </body>
    </html>
  );
}
