"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { documentsApi, ApiError } from "@/lib/api";
import type { DocumentListItem, DocumentStatus } from "@/lib/types";
import { DocumentStatusBadge, UrgencyBadge } from "@/components/ui/StatusBadge";

const TABS: { key: DocumentStatus | "all"; label: string }[] = [
  { key: "all", label: "全部" }, { key: "draft", label: "草稿" },
  { key: "pending", label: "待審核" }, { key: "approved", label: "已核准" },
  { key: "rejected", label: "已退件" }, { key: "archived", label: "已封存" },
];

export default function DocumentListPage() {
  const [docs, setDocs] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DocumentStatus | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (activeTab !== "all") params.status = activeTab;
    if (search.trim()) params.q = search.trim();
    documentsApi.list(params)
      .then(setDocs)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [activeTab, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">公文系統</h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>管理所有公文的建立、送審與追蹤</p>
        </div>
        <Link href="/documents/new" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--accent)", color: "#0a0e1a" }}>
          ＋ 新增公文
        </Link>
      </div>

      {/* 搜尋 + 篩選 */}
      <div className="flex flex-wrap items-center gap-3">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜尋公文標題或字號..."
          className="bg-transparent text-slate-300 text-sm px-3 py-1.5 rounded-lg outline-none w-64"
          style={{ border: "1px solid var(--border)" }} />
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          {TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={activeTab === key
                ? { background: "var(--accent-dim)", border: "1px solid var(--border-glow)", color: "var(--accent)" }
                : { color: "#475569" }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 表格 */}
      <div className="glass overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-500 text-sm">載入中...</div>
        ) : docs.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            {search ? `找不到「${search}」相關公文` : "尚無公文記錄"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--border)" }}>
                {["字號", "標題", "速別", "狀態", "日期", "操作"].map(h => (
                  <th key={h} className="px-5 py-3.5 text-xs font-medium" style={{ color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id} className="border-b hover:bg-white/[0.02] transition-colors group"
                  style={{ borderColor: "var(--border)" }}>
                  <td className="px-5 py-4">
                    <span className="text-xs font-mono" style={{ color: "var(--accent)" }}>{doc.serial_number}</span>
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/documents/${doc.id}`} className="text-slate-300 group-hover:text-slate-100 hover:underline">
                      {doc.title}
                    </Link>
                    {doc.subject && <p className="text-xs mt-0.5 truncate max-w-xs" style={{ color: "var(--muted)" }}>{doc.subject}</p>}
                  </td>
                  <td className="px-5 py-4"><UrgencyBadge urgency={doc.urgency} /></td>
                  <td className="px-5 py-4"><DocumentStatusBadge status={doc.status} /></td>
                  <td className="px-5 py-4 text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(doc.created_at).toLocaleDateString("zh-TW")}
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/documents/${doc.id}`}
                      className="text-xs px-2.5 py-1 rounded hover:opacity-80"
                      style={{ color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--border-glow)" }}>
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
