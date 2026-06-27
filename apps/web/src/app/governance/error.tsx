"use client";
import RouteError from "@/components/ui/RouteError";

export default function GovernanceError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="治理中樞" />;
}
