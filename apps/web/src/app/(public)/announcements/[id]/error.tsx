"use client";
import RouteError from "@/components/ui/RouteError";

export default function AnnouncementDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="公告" />;
}
