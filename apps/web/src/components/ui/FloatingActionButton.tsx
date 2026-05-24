"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface FABProps {
  href: string;
  label: string;
  /** 權限代碼；無 perm 則所有人可見。 */
  perm?: string;
  /** 自訂 icon（預設 Plus）。 */
  icon?: React.ReactNode;
  /**
   * 是否在桌面顯示（預設 false：僅 md: 以下顯示，桌面端列表頁通常已有右上 CTA）。
   */
  showOnDesktop?: boolean;
}

/**
 * 手機浮動主動作按鈕（右下 fixed）。
 * 避開 BottomTabBar（56px + safe-area），點擊導向 href。
 * 桌面端預設不顯示，避免與既有右上 CTA 重複。
 */
export default function FloatingActionButton({
  href,
  label,
  perm,
  icon,
  showOnDesktop = false,
}: FABProps) {
  const { can } = usePermissions();
  if (perm && !can(perm)) return null;

  return (
    <Link
      href={href}
      aria-label={label}
      className={`fixed right-4 z-20 flex items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${showOnDesktop ? "" : "md:hidden"}`}
      style={{
        bottom: "calc(72px + env(safe-area-inset-bottom))",
        width: "56px",
        height: "56px",
        background: "var(--primary)",
        color: "var(--primary-fg, #fff)",
        textDecoration: "none",
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
      }}>
      {icon ?? <Plus size={22} aria-hidden={true} />}
    </Link>
  );
}
