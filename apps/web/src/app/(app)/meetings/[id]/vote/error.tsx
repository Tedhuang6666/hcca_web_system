"use client";
import RouteError from "@/components/ui/RouteError";

export default function MeetingVoteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="議案投票" />;
}
