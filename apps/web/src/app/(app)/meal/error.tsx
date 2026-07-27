"use client";
import RouteError from "@/components/ui/RouteError";

export default function MealError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="學餐系統" />;
}
