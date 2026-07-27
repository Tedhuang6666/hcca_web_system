"use client";
import RouteError from "@/components/ui/RouteError";

export default function SearchError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="搜尋" />;
}
