"use client";
import RouteError from "@/components/ui/RouteError";

export default function TasksError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="待辦中心" />;
}
