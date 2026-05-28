"use client";
import RouteError from "@/components/ui/RouteError";

export default function PetitionsError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="陳情系統" />;
}
