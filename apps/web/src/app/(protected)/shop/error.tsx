"use client";
import RouteError from "@/components/ui/RouteError";

export default function ShopError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} scope="商品訂購" />;
}
