"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { regulationsApi, ApiError, regulationHref } from "@/lib/api";
import type { RegulationListItem, RegulationWorkflowStatus } from "@/lib/types";
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const PENDING_STATUSES: { key: RegulationWorkflowStatus; label: string; color: string; bg: string }[] = [
  { key: "under_review",     label: "送審中",   color: "#0284c7", bg: "rgba(2,132,199,0.1)" },
  { key: "scheduled",        label: "已排入議程", color: "#7c3aed", bg: "rgba(124,58,237,0.1)" },
  { key: "council_approved", label: "議會核定",  color: "#10b981", bg: "rgba(16,185,129,0.1)" },
];

export default function PendingRegulationsDashboard() {
  const [groups, setGroups] = useState<Record<RegulationWorkflowStatus, RegulationListItem[]>>({
    draft: [],
    under_review: [],
    scheduled: [],
    council_approved: [],
    published: [],
    rejected: [],
    archived: [],
  });
  const [loading, setLoading] = useState(true);
  const { can } = usePermissions();
  const canSeeAll = can("regulation:admin") || can("regulation:schedule") || can("regulation:council_approve") || can("regulation:president_publish");

  useEffect(() => {
    if (!canSeeAll) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all(
      PENDING_STATUSES.map((s) =>
        regulationsApi.list({ workflow_status: s.key, limit: "100" })
          .then((rows): [RegulationWorkflowStatus, RegulationListItem[]] => [s.key, rows])
          .catch((): [RegulationWorkflowStatus, RegulationListItem[]] => [s.key, []]),
      ),
    )
      .then((entries) => {
        const next = { ...groups };
        for (const [key, rows] of entries) next[key] = rows;
        setGroups(next);
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeAll]);

  const totalCount = useMemo(
    () => PENDING_STATUSES.reduce((sum, s) => sum + (groups[s.key]?.length ?? 0), 0),
    [groups],
  );

  if (!canSeeAll) {
    return (
      <main className="container mx-auto p-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>待審議案件集中頁</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--text-muted)" }}>
          您沒有檢視待審議案件的權限（需要議程排入、議會核定或主席公布權限）。
        </p>
      </main>
    );
  }

  return (
    <main className="container mx-auto p-6 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            待審議案件集中頁
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            集中查看所有送審中、已排入議程與議會核定後待公布的法規案件
          </p>
        </div>
        <span
          className="self-start sm:self-auto text-xs px-3 py-1.5 rounded-full font-medium"
          style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
        >
          共 {totalCount} 案
        </span>
      </header>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>載入中…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {PENDING_STATUSES.map((s) => {
            const rows = groups[s.key] ?? [];
            return (
              <section
                key={s.key}
                className="rounded-xl overflow-hidden flex flex-col"
                style={{ border: "1px solid var(--border)", background: "var(--bg-surface)" }}
              >
                <header
                  className="flex items-center justify-between px-4 py-3"
                  style={{ background: s.bg, borderBottom: "1px solid var(--border)" }}
                >
                  <span className="text-sm font-semibold" style={{ color: s.color }}>{s.label}</span>
                  <span className="text-xs font-medium" style={{ color: s.color }}>{rows.length}</span>
                </header>
                <div className="flex-1 min-h-[120px] max-h-[60vh] overflow-y-auto divide-y" style={{ borderColor: "var(--border)" }}>
                  {rows.length === 0 ? (
                    <p className="px-4 py-6 text-xs text-center" style={{ color: "var(--text-muted)" }}>
                      目前沒有此狀態的案件
                    </p>
                  ) : (
                    rows.map((r) => (
                      <Link
                        key={r.id}
                        href={regulationHref(r)}
                        className="block px-4 py-3 transition-colors hover:opacity-80"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
                            {r.title}
                          </p>
                          <RegulationCategoryBadge category={r.category} />
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          v{r.version} · {new Date(r.updated_at).toLocaleDateString("zh-TW")}
                        </p>
                      </Link>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
