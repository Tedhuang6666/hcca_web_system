"use client";
import RouteError from "@/components/ui/RouteError";

export default function MeetingControlError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="主席控制台" />;
}
