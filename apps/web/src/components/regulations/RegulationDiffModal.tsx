"use client";

import { useMemo } from "react";

import type { RegulationRevisionOut } from "@/lib/types";
import { buildRegulationDiffRows, type RegulationDiffSegment } from "./regulationDiff";

function DiffSegment({ segment }: { segment: RegulationDiffSegment }) {
  const type = /^\s+$/u.test(segment.text) ? "equal" : segment.type;
  return (
    <span
      style={{
        color: type === "add"
          ? "var(--success)"
          : type === "remove"
            ? "var(--danger)"
            : "var(--text-secondary)",
        textDecoration: type === "remove" ? "line-through" : "none",
        background: type === "add"
          ? "var(--success-dim)"
          : type === "remove"
            ? "var(--danger-dim)"
            : "transparent",
      }}
    >
      {segment.text}
    </span>
  );
}

export default function RegulationDiffModal({
  revA,
  revB,
  onClose,
}: {
  revA: RegulationRevisionOut;
  revB: RegulationRevisionOut | null;
  onClose: () => void;
}) {
  const oldText = revA.content_snapshot ?? "";
  const newText = revB?.content_snapshot ?? "";
  const oldLabel = `v${revA.version} · ${new Date(revA.amended_at).toLocaleDateString("zh-TW")} · ${revA.change_brief}`;
  const newLabel = revB
    ? `v${revB.version} · ${new Date(revB.amended_at).toLocaleDateString("zh-TW")} · ${revB.change_brief}`
    : "目前版本（無快照）";

  const diffResult = useMemo(() => {
    return buildRegulationDiffRows(oldText, newText);
  }, [oldText, newText]);

  const addCount = diffResult.filter((row) => row.type === "add").length;
  const removeCount = diffResult.filter((row) => row.type === "remove").length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "var(--bg-overlay)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="regulation-diff-title"
    >
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl"
        style={{
          width: "min(1100px, 96vw)",
          maxHeight: "90vh",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div
          className="flex flex-shrink-0 items-start justify-between px-5 py-3 sm:items-center"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span id="regulation-diff-title" className="shrink-0 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              版本比對
            </span>
            <span
              className="min-w-0 max-w-full whitespace-normal break-words rounded-full px-2 py-0.5 text-xs"
              style={{ background: "var(--danger-dim)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}
            >
              舊 {oldLabel}
            </span>
            <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>→</span>
            <span
              className="min-w-0 max-w-full whitespace-normal break-words rounded-full px-2 py-0.5 text-xs"
              style={{ background: "var(--success-dim)", color: "var(--success)", border: "1px solid var(--success-border)" }}
            >
              新 {newLabel}
            </span>
          </div>
          <button onClick={onClose} className="topbar-icon-btn ml-3 mt-1 flex-shrink-0 sm:mt-0" aria-label="關閉">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto" style={{ fontFamily: "monospace", fontSize: "12px", lineHeight: "1.65" }}>
          {diffResult.length === 0
            ? <p className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>兩個版本內容完全相同</p>
            : diffResult.map((row, index) => {
                const isAdd = row.type === "add";
                const isRemove = row.type === "remove";
                return (
                  <div
                    key={index}
                    className="flex items-start px-3 py-px"
                    style={{
                      background: row.segments
                        ? "transparent"
                        : isAdd
                          ? "var(--success-dim)"
                          : isRemove
                            ? "var(--danger-dim)"
                            : "transparent",
                    }}
                  >
                    <span
                      className="w-5 flex-shrink-0 select-none text-center font-bold"
                      style={{ color: isAdd ? "var(--success)" : isRemove ? "var(--danger)" : "var(--text-disabled)" }}
                    >
                      {isAdd ? "+" : isRemove ? "−" : " "}
                    </span>
                    <span
                      className="flex-1 whitespace-pre-wrap break-all pl-1"
                      style={{
                        color: isAdd
                          ? "var(--success)"
                          : isRemove
                            ? "var(--danger)"
                            : "var(--text-secondary)",
                        opacity: row.type === "equal" ? 0.8 : 1,
                      }}
                    >
                      {row.segments?.length
                        ? row.segments.map((segment, segmentIndex) => (
                            <DiffSegment key={segmentIndex} segment={segment} />
                          ))
                        : row.text || " "}
                    </span>
                  </div>
                );
              })}
        </div>

        <div
          className="flex flex-shrink-0 items-center gap-4 px-5 py-2 text-xs"
          style={{ borderTop: "1px solid var(--border)", background: "var(--bg-elevated)" }}
        >
          <span style={{ color: "var(--success)" }}>＋ {addCount} 行新增</span>
          <span style={{ color: "var(--danger)" }}>－ {removeCount} 行刪除</span>
          <span style={{ color: "var(--text-muted)" }}>
            {diffResult.filter((row) => row.type === "equal").length} 行不變
          </span>
        </div>
      </div>
    </div>
  );
}
