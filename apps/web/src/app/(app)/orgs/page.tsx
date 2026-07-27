"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { orgsApi, apiErrorMessage } from "@/lib/api";
import type { OrgRead } from "@/lib/api";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";

export default function OrgsPage() {
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    orgsApi.list()
      .then(setOrgs)
      .catch(e => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, []);

  // 建立樹狀結構（頂層：parent_id == null）
  const visibleOrgs = showInactive ? orgs : orgs.filter(o => o.is_active);
  const roots = visibleOrgs.filter(o => !o.parent_id || !visibleOrgs.some(parent => parent.id === o.parent_id));
  const childrenOf = (id: string) => visibleOrgs.filter(o => o.parent_id === id);

  function OrgCard({ org, depth = 0 }: { org: OrgRead; depth?: number }) {
    const children = childrenOf(org.id);
    return (
      <div style={{ marginLeft: depth * 16 }}>
        <Link href={`/orgs/${org.id}`}
          className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all group"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", textDecoration: "none" }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}>
          {/* 縮排指示 */}
          {depth > 0 && (
            <div className="w-3 h-3 flex-shrink-0 flex items-end justify-end">
              <div className="w-2 h-2 border-l border-b rounded-bl" style={{ borderColor: "var(--border-strong)" }} />
            </div>
          )}
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: org.is_active ? "var(--primary-dim)" : "var(--bg-surface)", color: org.is_active ? "var(--primary)" : "var(--text-muted)" }}>
            {org.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{org.name}</p>
              {!org.is_active && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)" }}>停用</span>
              )}
            </div>
            {org.description && (
              <p className="text-xs truncate mt-0.5" style={{ color: "var(--text-muted)" }}>{org.description}</p>
            )}
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 opacity-40 group-hover:opacity-80 transition-opacity"
            style={{ color: "var(--primary)" }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
        {children.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {children.map(c => <OrgCard key={c.id} org={c} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* 頁首 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>組織總覽</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            {orgs.filter(o => o.is_active).length} 個有效組織 · {orgs.filter(o => !o.is_active).length} 個停用組織
          </p>
        </div>
        <button
          onClick={() => setShowInactive(v => !v)}
          className="text-xs px-3 py-2 rounded-lg cursor-pointer"
          style={{ border: "1px solid var(--border)", color: showInactive ? "var(--primary)" : "var(--text-secondary)", background: showInactive ? "var(--primary-dim)" : "transparent" }}
        >
          {showInactive ? "隱藏停用組織" : "顯示停用組織"}
        </button>
      </div>

      {loading ? (
        <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
      ) : visibleOrgs.length === 0 ? (
        <SmartEmptyState reason="new" subject="組織" message="尚未建立任何組織，請聯絡管理員設定組織架構" />
      ) : (
        <div className="space-y-1.5">
          {roots.map(org => <OrgCard key={org.id} org={org} />)}
        </div>
      )}
    </div>
  );
}
