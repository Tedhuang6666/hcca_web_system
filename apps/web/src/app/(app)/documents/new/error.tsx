"use client";
import RouteError from "@/components/ui/RouteError";

export default function DocumentNewError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="新增公文" />;
}
