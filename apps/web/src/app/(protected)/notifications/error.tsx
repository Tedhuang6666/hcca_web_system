"use client";
import RouteError from "@/components/ui/RouteError";

export default function NotificationsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="通知中心" />;
}
