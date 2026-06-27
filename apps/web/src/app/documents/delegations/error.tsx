"use client";
import RouteError from "@/components/ui/RouteError";

export default function DocumentDelegationsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="公文代理設定" />;
}
