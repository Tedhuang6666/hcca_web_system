"use client";
import RouteErrorState from "@/components/ui/RouteErrorState";
export default function MeetingsError({ error, reset }: { error: Error & { digest?: string; status?: number }; reset: () => void }) {
  return <RouteErrorState error={error} reset={reset} />;
}
