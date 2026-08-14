"use client";
import RouteError from "@/components/ui/RouteError";

export default function OrgsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="組織系統" />;
}
