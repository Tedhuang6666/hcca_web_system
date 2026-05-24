"use client";
import Link from "next/link";
import { Inbox, Filter, Lock, Sparkles, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyReason = "new" | "filtered" | "denied" | "none";

interface SmartEmptyStateProps {
  /**
   * 為何看到空：
   * - "new"：新使用者 / 沒建立過任何資料 → 顯示「建立第一筆」CTA
   * - "filtered"：用了篩選後沒結果 → 顯示「清除篩選」CTA
   * - "denied"：權限不足 → 顯示聯絡管理員提示
   * - "none"：純沒資料，無特殊原因（fallback）
   */
  reason: EmptyReason;
  /** 主題名稱，例如「公文」「會議」「公告」。 */
  subject: string;
  /** 建立首筆的連結（reason="new" 時必填）。 */
  createHref?: string;
  /** 建立首筆的權限代碼（若提供且使用者無權則隱藏 CTA）。 */
  createPerm?: string;
  /** 清除篩選的 callback（reason="filtered" 時用）。 */
  onClearFilters?: () => void;
  /** 自訂訊息覆寫預設文案。 */
  message?: ReactNode;
  /** 自訂 icon。 */
  icon?: LucideIcon;
}

const DEFAULTS: Record<EmptyReason, { icon: LucideIcon; title: (s: string) => string }> = {
  new:      { icon: Sparkles, title: (s) => `還沒有任何${s}` },
  filtered: { icon: Filter,   title: () => "沒有符合條件的結果" },
  denied:   { icon: Lock,     title: (s) => `您無權檢視${s}` },
  none:     { icon: Inbox,    title: (s) => `目前沒有${s}` },
};

/**
 * 引導式空狀態：依「為什麼空」給對應的 CTA / 解釋，
 * 而非統一顯示「尚無資料」。
 *
 * 範例：
 *   <SmartEmptyState reason="new" subject="公文" createHref="/documents/new"
 *                    createPerm="document:create" />
 *   <SmartEmptyState reason="filtered" subject="公文"
 *                    onClearFilters={() => setFilter(null)} />
 */
export default function SmartEmptyState({
  reason,
  subject,
  createHref,
  createPerm,
  onClearFilters,
  message,
  icon,
}: SmartEmptyStateProps) {
  // usePermissions 在 client only；用動態 require 避免 SSR 問題
  let canCreate = true;
  if (createPerm && typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem("permissions");
      const isAdmin = window.localStorage.getItem("is_superuser") === "true";
      const perms: string[] = raw ? JSON.parse(raw) : [];
      canCreate = isAdmin || perms.includes("admin:all") || perms.includes(createPerm);
    } catch {
      canCreate = false;
    }
  }

  const Icon = icon ?? DEFAULTS[reason].icon;
  const title = DEFAULTS[reason].title(subject);

  return (
    <div
      className="text-center py-12 px-4"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}>
      <Icon
        size={36}
        aria-hidden={true}
        style={{ color: "var(--text-disabled)", display: "inline-block", marginBottom: 12 }}
      />
      <p className="text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      {message ? (
        <div className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          {message}
        </div>
      ) : (
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          {reason === "new" && `建立第一筆${subject}，從這裡開始`}
          {reason === "filtered" && "試試調整或清除篩選條件"}
          {reason === "denied" && "請聯絡管理員開啟相關權限"}
          {reason === "none" && `等${subject}建立後會顯示在這裡`}
        </p>
      )}

      <div className="flex flex-wrap gap-2 justify-center">
        {reason === "new" && createHref && canCreate && (
          <Link
            href={createHref}
            className="btn btn-primary"
            style={{ textDecoration: "none" }}>
            建立第一筆{subject}
          </Link>
        )}
        {reason === "filtered" && onClearFilters && (
          <button type="button" className="btn" onClick={onClearFilters}>
            清除篩選
          </button>
        )}
        {reason === "denied" && (
          <Link
            href="/profile"
            className="btn"
            style={{ textDecoration: "none" }}>
            查看我的權限
          </Link>
        )}
      </div>
    </div>
  );
}
