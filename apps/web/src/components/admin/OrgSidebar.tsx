"use client";

import { useMemo, useState } from "react";

import type { AdminUserDetail, OrgWithPositions } from "@/lib/types";

interface OrgSidebarProps {
  orgs: OrgWithPositions[];
  users: AdminUserDetail[];
  selectedPosId: string | null;
  viewingUsers: boolean;
  onSelectPos: (id: string) => void;
  onSelectAllUsers: () => void;
  onNewPosition: () => void;
}

export default function OrgSidebar({
  orgs,
  users,
  selectedPosId,
  viewingUsers,
  onSelectPos,
  onSelectAllUsers,
  onNewPosition,
}: OrgSidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(orgs.map((o) => o.id)));

  const memberCount = useMemo(() => {
    const m: Record<string, number> = {};
    users.forEach((u) =>
      u.positions.forEach((p) => {
        m[p.id] = (m[p.id] ?? 0) + 1;
      }),
    );
    return m;
  }, [users]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  return (
    <aside className="flex flex-col h-full" style={{ borderRight: "1px solid var(--border)" }}>
      <button
        onClick={onSelectAllUsers}
        className="flex items-center gap-2.5 mx-3 mt-3 px-3 py-2.5 rounded-xl text-sm transition-all"
        style={
          viewingUsers
            ? {
                background: "var(--primary-dim)",
                color: "var(--primary)",
                border: "1px solid var(--border-strong)",
              }
            : { color: "var(--text-secondary)", border: "1px solid transparent" }
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span className="font-medium">全部使用者</span>
        <span
          className="ml-auto text-[11px] rounded-full px-1.5 py-0.5 font-medium"
          style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}
        >
          {users.length}
        </span>
      </button>

      <div className="mx-3 mt-3 mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest px-1" style={{ color: "var(--text-muted)" }}>
          職位 / 身份組
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {orgs.map((org) => (
          <div key={org.id}>
            <button
              onClick={() => toggle(org.id)}
              className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-left text-xs font-semibold transition-colors hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="flex-shrink-0 transition-transform"
                style={{ transform: expanded.has(org.id) ? "rotate(90deg)" : "none" }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="truncate">{org.name}</span>
            </button>

            {expanded.has(org.id) && (
              <div className="ml-4 mt-0.5 space-y-0.5">
                {org.positions.map((p) => {
                  const cnt = memberCount[p.id] ?? 0;
                  const active = selectedPosId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => onSelectPos(p.id)}
                      className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left text-xs transition-all"
                      style={
                        active
                          ? {
                              background: "var(--primary-dim)",
                              color: "var(--primary)",
                              border: "1px solid var(--border-strong)",
                            }
                          : { color: "var(--text-secondary)", border: "1px solid transparent" }
                      }
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: active ? "var(--primary)" : "var(--border-strong)" }}
                      />
                      <span className="flex-1 truncate">{p.name}</span>
                      {cnt > 0 && (
                        <span
                          className="text-[10px] font-medium rounded-full px-1.5"
                          style={{
                            background: active ? "var(--border-strong)" : "var(--bg-elevated)",
                            color: active ? "var(--primary)" : "var(--text-disabled)",
                          }}
                        >
                          {cnt}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={onNewPosition}
          className="flex items-center justify-center gap-2 w-full py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90"
          style={{
            background: "var(--primary-dim)",
            color: "var(--primary)",
            border: "1px solid var(--border-strong)",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新增職位
        </button>
      </div>
    </aside>
  );
}

