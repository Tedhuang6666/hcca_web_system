"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, FolderKanban, Loader2, Plus } from "lucide-react";
import { governanceApi } from "@/lib/api";
import type { GovernanceDashboardOut } from "@/lib/types";

export default function GovernanceSwitcher() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<GovernanceDashboardOut | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || data || loading) return;
    setLoading(true);
    governanceApi
      .dashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [data, loading, open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const matters = data?.matters ?? [];
  const stats = data?.stats;

  return (
    <div className="relative hidden sm:block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors"
        style={{
          background: open ? "var(--primary-dim)" : "var(--bg-hover)",
          color: open ? "var(--primary)" : "var(--text-secondary)",
          border: `1px solid ${open ? "var(--info-border)" : "var(--border)"}`,
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <FolderKanban size={14} aria-hidden={true} />
        <span className="hidden lg:inline">治理工作區</span>
        {(stats?.overdue_matters ?? 0) > 0 && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: "var(--danger)", color: "#fff" }}
            aria-label={`${stats?.overdue_matters} 件逾期事情`}
          >
            {stats?.overdue_matters}
          </span>
        )}
        <ChevronDown size={12} aria-hidden={true} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="治理工作區"
          className="absolute right-0 top-full z-50 mt-1.5 w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-xl)",
          }}
        >
          <div className="p-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  治理工作區
                </p>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  隨時切回正在推進的事情
                </p>
              </div>
              <Link
                href="/governance#quick-create"
                onClick={() => setOpen(false)}
                className="btn btn-primary"
              >
                <Plus size={13} aria-hidden={true} />
                建立
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <SwitcherStat label="進行中" value={stats?.active_matters ?? 0} />
              <SwitcherStat label="開放案件" value={stats?.open_cases ?? 0} />
              <SwitcherStat label="逾期" value={stats?.overdue_matters ?? 0} danger />
            </div>
          </div>

          <div className="max-h-[340px] overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs" style={{ color: "var(--text-muted)" }}>
                <Loader2 size={14} className="animate-spin" aria-hidden={true} />
                載入治理事項
              </div>
            ) : matters.length > 0 ? (
              matters.slice(0, 7).map((matter) => (
                <Link
                  key={matter.id}
                  href={`/governance/${matter.id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors"
                  style={{ textDecoration: "none" }}
                >
                  <span
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: "var(--primary-dim)",
                      color: "var(--primary)",
                      border: "1px solid var(--info-border)",
                    }}
                  >
                    <FolderKanban size={14} aria-hidden={true} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {matter.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                      {matter.progress_percent}% · {matter.case_count} 案件 · {matter.open_task_count} 任務
                    </span>
                  </span>
                  <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
                </Link>
              ))
            ) : (
              <div className="px-3 py-8 text-center">
                <AlertTriangle size={20} className="mx-auto" aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  尚未建立治理事項
                </p>
              </div>
            )}
          </div>

          <Link
            href="/governance"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1 px-4 py-3 text-xs font-medium"
            style={{
              color: "var(--primary)",
              borderTop: "1px solid var(--border)",
              textDecoration: "none",
            }}
          >
            開啟完整治理中樞
            <ChevronRight size={12} aria-hidden={true} />
          </Link>
        </div>
      )}
    </div>
  );
}

function SwitcherStat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md px-2.5 py-2" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 text-base font-semibold" style={{ color: danger && value > 0 ? "var(--danger)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}
