"use client";
import RouteError from "@/components/ui/RouteError";

export default function AuditLogsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="稽核日誌" />;
}
