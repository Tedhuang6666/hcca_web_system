"use client";
import RouteError from "@/components/ui/RouteError";

export default function AnalyticsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="分析儀表板" />;
}
