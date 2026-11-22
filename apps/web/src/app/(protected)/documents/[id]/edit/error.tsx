"use client";
import RouteError from "@/components/ui/RouteError";

export default function DocumentEditError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="公文編輯" />;
}
