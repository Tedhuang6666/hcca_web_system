"use client";
import { useEffect } from "react";

import { reportClientError } from "@/lib/client-error-reporter";
import RouteErrorState from "@/components/ui/RouteErrorState";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void reportClientError({
      scope: "global.error",
      message: error.message || "Global error",
      stack: error.stack,
      dedupeKey: error.digest ?? error.stack ?? error.message,
    });
  }, [error]);

  return <RouteErrorState error={error} reset={reset} />;
}
