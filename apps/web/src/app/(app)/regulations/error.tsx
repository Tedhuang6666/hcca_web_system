"use client";
import RouteError from "@/components/ui/RouteError";

export default function RegulationsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="法規系統" />;
}
