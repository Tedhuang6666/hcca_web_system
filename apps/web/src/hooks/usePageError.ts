"use client";

import { useEffect, useState } from "react";
import { reportClientError, type ClientErrorReceipt } from "@/lib/client-error-reporter";
import { errorCode, errorPresentation } from "@/lib/error-presentation";

// Boundaries and their fallback share both the side effect and its receipt,
// including an effect that is cleaned up and restarted during Strict Mode.
const incidents = new WeakMap<Error, Promise<ClientErrorReceipt | null>>();

export function usePageError(error: Error, scope: string) {
  const [acknowledged, setAcknowledged] = useState<{ error: Error; id: string } | null>(null);

  useEffect(() => {
    let active = true;
    let incident = incidents.get(error);
    if (!incident) {
      incident = Promise.resolve().then(() => reportClientError({
        scope,
        message: error.message || "Page error",
        stack: error.stack,
        dedupeKey: (error as Error & { digest?: string }).digest ?? error.stack ?? error.message,
      })).catch(() => null);
      incidents.set(error, incident);
    }
    void incident.then((receipt) => {
      if (active && receipt?.error_id) setAcknowledged({ error, id: receipt.error_id });
    });
    return () => { active = false; };
  }, [error, scope]);

  return {
    code: acknowledged?.error === error ? acknowledged.id : errorCode(error),
    presentation: errorPresentation(error),
  };
}
