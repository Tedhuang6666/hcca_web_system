"use client";
import RouteError from "@/components/ui/RouteError";

export default function EmailError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="電子郵件" />;
}
