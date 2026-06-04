"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";

import { apiUrl } from "@/lib/config";

type RegulationRevisionOut = {
  id: string;
  version: number;
  change_brief: string;
  is_total_amendment: boolean;
  content_snapshot: string;
  amended_at: string;
};

type RegulationOut = {
  id: string;
  title: string;
  version: number;
  revisions: RegulationRevisionOut[];
  content: string;
};

function pickByVersion(revs: RegulationRevisionOut[], v: number | null) {
  if (v == null) return null;
  return revs.find(r => r.version === v) ?? null;
}

export default function PublicRegulationComparePage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const fromV = sp.get("from") ? Number(sp.get("from")) : null;
  const toV = sp.get("to") ? Number(sp.get("to")) : null;

  const [reg, setReg] = useState<RegulationOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(apiUrl(`/regulations/${encodeURIComponent(id)}`))
      .then(r => (r.ok ? r.json() : null))
      .then(setReg)
      .finally(() => setLoading(false));
  }, [id]);

  const sorted = useMemo(() => {
    const revs = reg?.revisions ?? [];
    return [...revs].sort((a, b) => a.version - b.version);
  }, [reg?.revisions]);

  const defaultPair = useMemo(() => {
    if (sorted.length === 0) return { a: null as RegulationRevisionOut | null, b: null as RegulationRevisionOut | null };
    const b = sorted.at(-1) ?? null;
    const a = sorted.length >= 2 ? sorted.at(-2) ?? null : null;
    return { a, b };
  }, [sorted]);

  const [leftV, setLeftV] = useState<number | null>(fromV);
  const [rightV, setRightV] = useState<number | null>(toV);

  useEffect(() => {
    if (!reg) return;
    if (leftV == null) setLeftV(defaultPair.a?.version ?? null);
    if (rightV == null) setRightV(defaultPair.b?.version ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg?.id]);

  const left = pickByVersion(sorted, leftV) ?? defaultPair.a;
  const right = pickByVersion(sorted, rightV) ?? defaultPair.b;

  const diffRows = useMemo(() => {
    const oldText = left?.content_snapshot ?? "";
    const newText = right?.content_snapshot ?? "";
    const changes = diffLines(oldText, newText, { ignoreWhitespace: false });
    const rows: Array<{ t: "add" | "remove" | "equal"; line: string }> = [];
    for (const ch of changes) {
      const lines = ch.value.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      for (const line of lines) {
        rows.push({ t: ch.added ? "add" : ch.removed ? "remove" : "equal", line });
      }
    }
    return rows;
  }, [left?.content_snapshot, right?.content_snapshot]);

  if (loading) return <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>載入中…</div>;
  if (!reg) return <div className="py-16 text-center text-sm" style={{ color: "var(--danger)" }}>找不到此法規或尚未公開</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            版本並排比對
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {reg.title}
          </p>
        </div>
      </div>

      <div className="card p-4 flex flex-col lg:flex-row gap-3 items-start lg:items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>左側版本</label>
          <select
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            value={left?.version ?? ""}
            onChange={(e) => setLeftV(Number(e.target.value))}
          >
            {sorted.map(r => (
              <option key={r.id} value={r.version}>v{r.version} · {r.change_brief}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 w-full">
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--text-muted)" }}>右側版本</label>
          <select
            className="w-full text-sm px-3 py-2 rounded-lg outline-none"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            value={right?.version ?? ""}
            onChange={(e) => setRightV(Number(e.target.value))}
          >
            {sorted.map(r => (
              <option key={r.id} value={r.version}>v{r.version} · {r.change_brief}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setLeftV(defaultPair.a?.version ?? null); setRightV(defaultPair.b?.version ?? null); }}
            className="text-xs px-3 py-2 rounded-lg hover:opacity-80"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            回到最新/前版
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <div className="card overflow-hidden">
          <div className="px-5 py-3 text-xs font-semibold" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
            左：v{left?.version ?? "—"} · {left ? new Date(left.amended_at).toLocaleDateString("zh-TW") : ""}
          </div>
          <div className="p-5">
            {left?.content_snapshot ? (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{left.content_snapshot}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>無快照內容</p>
            )}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3 text-xs font-semibold" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
            右：v{right?.version ?? "—"} · {right ? new Date(right.amended_at).toLocaleDateString("zh-TW") : ""}
          </div>
          <div className="p-5">
            {right?.content_snapshot ? (
              <div className="prose prose-sm max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{right.content_snapshot}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>無快照內容</p>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 text-xs font-semibold" style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
          逐行差異（輔助）
        </div>
        <div className="max-h-[60vh] overflow-auto font-mono text-xs">
          {diffRows.length === 0 ? (
            <div className="p-10 text-center" style={{ color: "var(--text-muted)" }}>兩版本內容相同</div>
          ) : (
            diffRows.map((r, i) => (
              <div
                key={i}
                className="px-4 py-[2px] whitespace-pre-wrap break-all flex gap-2"
                style={{
                  background: r.t === "add" ? "rgba(34,197,94,0.10)" : r.t === "remove" ? "rgba(239,68,68,0.10)" : "transparent",
                }}
              >
                <span style={{ width: 18, color: r.t === "add" ? "#4ade80" : r.t === "remove" ? "#f87171" : "var(--text-disabled)", textAlign: "center" }}>
                  {r.t === "add" ? "+" : r.t === "remove" ? "−" : " "}
                </span>
                <span
                  style={{
                    color: r.t === "add" ? "#86efac" : r.t === "remove" ? "#fca5a5" : "var(--text-secondary)",
                    textDecoration: r.t === "remove" ? "line-through" : "none",
                    opacity: r.t === "equal" ? 0.8 : 1,
                  }}
                >
                  {r.line || " "}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
