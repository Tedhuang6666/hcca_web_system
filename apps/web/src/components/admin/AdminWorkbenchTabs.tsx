"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";

const TABS = [
  { section: "people", label: "人員與身分", description: "人員主檔、身分與歸屬" },
  { section: "accounts", label: "帳號與安全", description: "登入、驗證與帳號設定" },
  { section: "lifecycle", label: "帳號停權與學籍", description: "凍結、歸檔與解凍" },
  { section: "organization", label: "組織、職位與權限", description: "組織架構、任期與授權" },
  { section: "classes", label: "班級與名冊", description: "班級、座號與班級幹部" },
  { section: "import", label: "批次匯入", description: "從幹部通訊錄建立資料" },
] as const;

export default function AdminWorkbenchTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { can, isAdmin } = usePermissions();
  const canManagePeople = isAdmin || can("admin:all") || can("admin:users") || can("class:manage") || can("org:manage_members");
  const visibleTabs = TABS.filter(({ section }) => {
    if (section === "people") return canManagePeople;
    if (section === "accounts") return isAdmin || can("admin:all");
    if (section === "organization") return isAdmin || can("admin:all") || can("admin:users") || can("org:manage_members");
    if (section === "lifecycle" || section === "import") return isAdmin || can("admin:all");
    return isAdmin || can("admin:all") || can("class:manage");
  });
  const legacySection = pathname.startsWith("/admin/users")
    ? "accounts"
    : pathname.startsWith("/admin/user-lifecycle")
      ? "lifecycle"
      : pathname.startsWith("/admin/permissions")
        ? "organization"
        : pathname.startsWith("/admin/classes")
          ? "classes"
          : pathname.startsWith("/admin/cadre-import")
            ? "import"
            : "people";
  const activeSection = pathname === "/admin/people"
    ? searchParams.get("section") ?? "people"
    : legacySection;

  return (
    <nav
      aria-label="人員與組織管理"
      className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b px-3 sm:px-4"
      style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
    >
      {visibleTabs.map(({ section, label, description }) => {
        const active = activeSection === section;
        return (
          <Link
            key={section}
            href={section === "people" ? "/admin/people" : `/admin/people?section=${section}`}
            title={description}
            aria-current={active ? "page" : undefined}
            className="relative min-h-11 shrink-0 px-3 py-3 text-sm font-medium transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--primary)] sm:px-4"
            style={{
              color: active ? "var(--primary)" : "var(--text-muted)",
              textDecoration: "none",
            }}
          >
            {label}
            {active && (
              <span
                className="absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                style={{ background: "var(--primary)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
