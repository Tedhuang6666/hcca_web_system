"use client";
import RouteError from "@/components/ui/RouteError";

export default function SurveysError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="問卷系統" />;
}
