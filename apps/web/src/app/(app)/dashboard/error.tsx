"use client";
import RouteError from "@/components/ui/RouteError";

export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="儀表板" />;
}
