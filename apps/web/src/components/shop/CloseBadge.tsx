import type { CloseStatusItem } from "@/lib/types";

export function CloseBadge({ status, partial = false }: { status: CloseStatusItem | undefined; partial?: boolean }) {
  if (!status && !partial) return <span className="text-xs text-[var(--text-secondary)]">狀態待確認</span>;
  if (partial) return (
    <span className="rounded-full bg-[rgba(245,158,11,0.12)] px-2 py-0.5 text-xs text-[#b45309]">
      部分商品停止訂購
    </span>
  );
  if (!status?.is_closed) return (
    <span className="rounded-full bg-[rgba(34,197,94,0.12)] px-2 py-0.5 text-xs text-[#16a34a]">
      開放訂購
    </span>
  );
  return (
    <span className="rounded-full bg-[rgba(239,68,68,0.1)] px-2 py-0.5 text-xs text-[#ef4444]">
      已停止訂購
    </span>
  );
}
