"use client";

import { useEffect } from "react";
import RouteErrorState from "@/components/ui/RouteErrorState";
import { reportClientError } from "@/lib/client-error-reporter";

export default function ProtectedError({ error, reset }: { error: Error & { digest?: string; status?: number }; reset: () => void }) {
  useEffect(() => {
    void reportClientError({ scope: "protected.error", message: error.message, stack: error.stack, dedupeKey: error.digest ?? error.stack ?? error.message });
  }, [error]);
  return <RouteErrorState error={error} reset={reset} />;
}
