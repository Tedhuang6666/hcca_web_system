"use client";
import RouteErrorState from "@/components/ui/RouteErrorState";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState error={error} reset={reset} scope="global.error" />;
}
