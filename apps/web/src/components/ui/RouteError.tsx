"use client";

import RouteErrorState from "./RouteErrorState";

/** Route segments and module fallbacks share one error/receipt lifecycle. */
export default function RouteError({ error, reset, scope = "頁面" }: {
  error: Error & { digest?: string };
  reset: () => void;
  scope?: string;
}) {
  return <RouteErrorState error={error} reset={reset} scope={`route:${scope}`} embedded />;
}
