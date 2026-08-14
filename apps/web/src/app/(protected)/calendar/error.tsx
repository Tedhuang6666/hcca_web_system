"use client";
import RouteError from "@/components/ui/RouteError";

export default function CalendarError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="行事曆" />;
}
