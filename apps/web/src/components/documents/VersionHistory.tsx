"use client";
import { useState } from "react";
import type { RevisionOut } from "@/lib/types";

export function VersionHistory({ revisions }: { revisions: RevisionOut[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (revisions.length === 0) {
    return (
      <div className="glass p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>版本歷程</h3>
        <p className="text-xs" style={{ color: "var(--muted)" }}>尚無版本記錄</p>
      </div>
    );
  }

  return (
    <div className="glass p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
        版本歷程 <span className="ml-1 px-1.5 py-0.5 rounded text-xs" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
          {revisions.length}
        </span>
      </h3>
      <div className="space-y-2">
        {[...revisions].sort((a, b) => b.revision_number - a.revision_number).map((rev) => (
          <div key={rev.id}>
            <button
              onClick={() => setExpanded(expanded === rev.id ? null : rev.id)}
              className="w-full flex items-center justify-between text-xs px-3 py-2 rounded transition-all hover:opacity-90"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold" style={{ color: "var(--accent)" }}>
                  v{rev.revision_number}
                </span>
                <span className="text-slate-300 truncate max-w-[160px]">{rev.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {rev.change_note && (
                  <span className="text-slate-500 truncate max-w-[100px]">{rev.change_note}</span>
                )}
                <span style={{ color: "var(--muted)" }}>
                  {new Date(rev.created_at).toLocaleDateString("zh-TW")}
                </span>
                <span style={{ color: "var(--muted)" }}>{expanded === rev.id ? "▲" : "▼"}</span>
              </div>
            </button>
            {expanded === rev.id && (
              <div className="mt-1 p-3 rounded text-xs text-slate-400 font-mono whitespace-pre-wrap"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                {rev.content || <span style={{ color: "var(--muted)" }}>（無內容）</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
