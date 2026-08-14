"use client";
import RouteError from "@/components/ui/RouteError";

export default function ProfileError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="個人資料" />;
}
