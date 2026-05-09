"use client";
import { useState } from "react";
import type { RevisionOut } from "@/lib/types";

export function VersionHistory({ revisions }: { revisions: RevisionOut[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (revisions.length === 0) {
    return (
      <div className="card p-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-2"
          style={{ color: "var(--text-muted)" }}>
          版本歷程
        </h3>
        <p className="text-xs" style={{ color: "var(--text-disabled)" }}>尚無版本記錄</p>
      </div>
    );
  }

  const sorted = [...revisions].sort((a, b) => b.revision_number - a.revision_number);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}>
          版本歷程
        </h3>
        <span
          className="badge text-[10px]"
          style={{ color: "var(--primary)", background: "var(--primary-dim)", borderColor: "var(--primary-dim)" }}>
          {revisions.length}
        </span>
      </div>

      <ul className="space-y-1.5" aria-label="版本列表">
        {sorted.map((rev) => {
          const isOpen = expanded === rev.id;
          return (
            <li key={rev.id}>
              <button
                onClick={() => setExpanded(isOpen ? null : rev.id)}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between text-xs px-3 py-2.5 rounded-xl transition-all"
                style={{
                  background: isOpen ? "var(--primary-dim)" : "var(--bg-elevated)",
                  border: `1px solid ${isOpen ? "var(--border-focus)" : "var(--border)"}`,
                  color: isOpen ? "var(--primary)" : "var(--text-secondary)",
                }}>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold" style={{ color: "var(--primary)" }}>
                    v{rev.revision_number}
                  </span>
                  <span className="truncate max-w-36" style={{ color: "var(--text-primary)" }}>
                    {rev.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {rev.change_note && (
                    <span className="truncate max-w-24 hidden sm:block" style={{ color: "var(--text-muted)" }}>
                      {rev.change_note}
                    </span>
                  )}
                  <span style={{ color: "var(--text-muted)" }}>
                    {new Date(rev.created_at).toLocaleDateString("zh-TW")}
                  </span>
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                    className="transition-transform duration-200"
                    style={{
                      color: "var(--text-muted)",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                    aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {isOpen && (
                <div
                  className="mt-1 p-3 rounded-xl text-xs font-mono whitespace-pre-wrap animate-fade-in"
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    color: "var(--text-secondary)",
                  }}>
                  {rev.content || (
                    <span style={{ color: "var(--text-disabled)" }}>（無內容）</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
