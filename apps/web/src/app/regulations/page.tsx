"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { regulationsApi, ApiError } from "@/lib/api";
import type { RegulationListItem, RegulationCategory } from "@/lib/types";
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";

const CATEGORIES: { key: RegulationCategory | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "charter", label: "章程" },
  { key: "bylaw", label: "細則" },
  { key: "procedure", label: "辦法" },
  { key: "policy", label: "政策" },
  { key: "other", label: "其他" },
];

export default function RegulationsPage() {
  const [regs, setRegs] = useState<RegulationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<RegulationCategory | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (category !== "all") params.category = category;
    if (search.trim()) params.q = search.trim();
    regulationsApi.list(params)
      .then(data => setRegs(data.filter(r => r.is_active)))
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [category, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">法規查詢</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>瀏覽組織章程、辦法與政策文件</p>
        </div>
      </div>

      {/* 搜尋 + 分類 */}
      <div className="flex flex-wrap items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜尋法規名稱..."
          className="bg-transparent text-slate-300 text-sm px-3 py-1.5 rounded-lg outline-none w-56"
          style={{ border: "1px solid var(--border)" }} />
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {CATEGORIES.map(({ key, label }) => (
            <button key={key} onClick={() => setCategory(key)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={category === key
                ? { background: "var(--accent-dim)", border: "1px solid var(--border-glow)", color: "var(--accent)" }
                : { color: "#475569" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="py-20 text-center text-slate-500">載入中...</div>
      ) : regs.length === 0 ? (
        <div className="py-20 text-center text-slate-500">找不到符合條件的法規</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {regs.map(reg => (
            <Link key={reg.id} href={`/regulations/${reg.id}`}
              className="glass p-4 flex flex-col gap-3 hover:border-sky-400/40 transition-all group"
              style={{ textDecoration: "none" }}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-slate-100 group-hover:text-sky-300 transition-colors text-sm leading-snug">
                  {reg.title}
                </h3>
                <RegulationCategoryBadge category={reg.category} />
              </div>
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
                <span>版本 v{reg.version}</span>
                {reg.published_at
                  ? <span>發布於 {new Date(reg.published_at).toLocaleDateString("zh-TW")}</span>
                  : <span>草稿</span>}
              </div>
              <div className="flex items-center gap-1 text-xs" style={{ color: "var(--accent)" }}>
                <span>閱讀全文</span>
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
