"use client";
import RouteError from "@/components/ui/RouteError";

export default function DocumentDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="公文" />;
}
