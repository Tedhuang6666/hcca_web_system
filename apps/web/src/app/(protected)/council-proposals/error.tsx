"use client";
import RouteError from "@/components/ui/RouteError";

export default function CouncilProposalsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="議案" />;
}
