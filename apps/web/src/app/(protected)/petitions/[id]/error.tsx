"use client";
import RouteError from "@/components/ui/RouteError";

export default function PetitionDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} scope="陳情" />;
}
