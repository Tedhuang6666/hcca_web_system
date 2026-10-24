"use client";

import RouteErrorState from "@/components/ui/RouteErrorState";

export default function ProtectedError({ error, reset }: { error: Error & { digest?: string; status?: number }; reset: () => void }) {
  return <RouteErrorState error={error} reset={reset} scope="protected.error" />;
}
