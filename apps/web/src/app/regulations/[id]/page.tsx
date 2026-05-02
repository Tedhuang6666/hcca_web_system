"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { regulationsApi, ApiError } from "@/lib/api";
import type { RegulationOut } from "@/lib/types";
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";

export default function RegulationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [reg, setReg] = useState<RegulationOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    regulationsApi.get(id)
      .then(setReg)
      .catch(e => toast.error(e instanceof ApiError ? e.message : "載入失敗"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-20 text-center text-slate-500">載入中...</div>;
  if (!reg) return <div className="py-20 text-center text-red-400">法規不存在或無法存取</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* 頂部 */}
      <div className="flex items-center gap-3">
        <Link href="/regulations" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-200"
          style={{ border: "1px solid var(--border)" }}>←</Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <RegulationCategoryBadge category={reg.category} />
            <span className="text-xs" style={{ color: "var(--muted)" }}>版本 v{reg.version}</span>
            {!reg.is_active && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>
                已停用
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold text-slate-100">{reg.title}</h1>
          {reg.published_at && (
            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
              發布日期：{new Date(reg.published_at).toLocaleDateString("zh-TW")}
            </p>
          )}
        </div>
      </div>

      {/* Markdown 內容 */}
      <div className="glass p-6">
        <div className="prose prose-invert prose-sm max-w-none
          prose-headings:text-slate-100 prose-headings:font-semibold
          prose-p:text-slate-300 prose-p:leading-relaxed
          prose-a:text-sky-400 prose-a:no-underline hover:prose-a:underline
          prose-strong:text-slate-200 prose-strong:font-semibold
          prose-code:text-sky-300 prose-code:bg-sky-900/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-700
          prose-blockquote:border-l-sky-500 prose-blockquote:text-slate-400
          prose-li:text-slate-300
          prose-hr:border-slate-700
          prose-table:text-slate-300 prose-th:text-slate-200 prose-th:bg-slate-800/50
          prose-td:border-slate-700 prose-th:border-slate-700">
          {reg.content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{reg.content}</ReactMarkdown>
          ) : (
            <p className="text-slate-500 italic">此法規尚無內容。</p>
          )}
        </div>
      </div>

      {/* 頁尾資訊 */}
      <div className="glass p-4">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          {[
            ["最後更新", new Date(reg.updated_at).toLocaleString("zh-TW")],
            ["建立日期", new Date(reg.created_at).toLocaleDateString("zh-TW")],
            ["狀態", reg.is_active ? "✅ 生效中" : "⛔ 已停用"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt style={{ color: "var(--muted)" }}>{k}</dt>
              <dd className="mt-0.5 text-slate-300">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
