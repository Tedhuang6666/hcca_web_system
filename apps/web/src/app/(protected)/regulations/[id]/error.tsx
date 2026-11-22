"use client";
import RouteError from "@/components/ui/RouteError";

export default function RegulationDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="法規" />;
}
