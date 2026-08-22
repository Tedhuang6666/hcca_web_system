import { Compass } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";

export default function PublicRouteNotFound() {
  return (
    <main className="mx-auto flex min-h-[52vh] w-full max-w-6xl items-center px-4 sm:px-6">
      <EmptyState
        icon={<Compass size={40} aria-hidden />}
        title="找不到這個頁面"
        description="連結可能已更新，或該公開內容已不再提供。"
        action={{ label: "返回首頁", href: "/" }}
      />
    </main>
  );
}
