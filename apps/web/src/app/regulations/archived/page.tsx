"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Archive, Search } from "lucide-react";
import { regulationsApi, regulationHref, apiErrorMessage } from "@/lib/api";
import type { RegulationListItem, RegulationCategory } from "@/lib/types";
import { ListPageSkeleton } from "@/components/ui/Skeleton";
import SmartEmptyState from "@/components/ui/SmartEmptyState";
import { RegulationCategoryBadge } from "@/components/ui/StatusBadge";

const CATEGORIES: { key: RegulationCategory | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "constitution", label: "憲章" },
  { key: "ordinance", label: "條例" },
  { key: "procedure", label: "辦法" },
];

export default function ArchivedRegulationsPage() {
  const [regs, setRegs] = useState<RegulationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<RegulationCategory | "all">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    regulationsApi
      .list({ workflow_status: "archived", limit: "100" })
      .then(setRegs)
      .catch((e) => toast.error(apiErrorMessage(e, "載入失敗")))
      .finally(() => setLoading(false));
  }, []);

  const displayed = useMemo(() => {
    return regs
      .filter((r) => category === "all" || r.category === category)
      .filter((r) => !search.trim() || r.title.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b.repealed_date ?? "").localeCompare(a.repealed_date ?? ""));
  }, [regs, category, search]);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/regulations"
            className="inline-flex items-center gap-1 text-xs mb-2 hover:underline"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft size={12} aria-hidden /> 回到法規列表
          </Link>
          <div className="flex items-center gap-2">
            <Archive size={18} aria-hidden style={{ color: "var(--text-muted)" }} />
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              廢止法規
            </h1>
          </div>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            歷史上已廢止的法規，可查詢替代法規與廢止原因
          </p>
        </div>
      </div>

      {/* 搜尋 + 分類 */}
      <div className="card p-4 flex flex-col gap-3">
        <div className="relative w-full">
          <Search
            size={14}
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋廢止法規…"
            className="input pl-11 w-full min-w-0"
            aria-label="搜尋廢止法規"
          />
        </div>
        <div className="flex w-full flex-wrap gap-1.5" role="group" aria-label="法規分類篩選">
          {CATEGORIES.map(({ key, label }) => {
            const active = category === key;
            return (
              <button
                key={key}
                aria-pressed={active}
                onClick={() => setCategory(key)}
                className="px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap cursor-pointer hover:opacity-80"
                style={
                  active
                    ? {
                        background: "var(--primary-dim)",
                        color: "var(--primary)",
                        border: "1px solid var(--border-strong)",
                      }
                    : {
                        color: "var(--text-muted)",
                        border: "1px solid var(--border)",
                        background: "var(--bg-surface)",
                      }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {!loading && displayed.length > 0 && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          共 {displayed.length} 部廢止法規
        </p>
      )}

      {loading ? (
        <ListPageSkeleton rows={5} showHeader={false} showFilters={false} />
      ) : displayed.length === 0 ? (
        <SmartEmptyState
          reason={search.trim() || category !== "all" ? "filtered" : "none"}
          subject="廢止法規"
          onClearFilters={() => {
            setSearch("");
            setCategory("all");
          }}
          message={
            search.trim() || category !== "all"
              ? undefined
              : "尚未有任何廢止記錄，所有現行法規仍有效"
          }
        />
      ) : (
        <ul className="space-y-2 list-none p-0 m-0">
          {displayed.map((reg) => (
            <li key={reg.id}>
              <Link
                href={regulationHref(reg)}
                className="card card-hover flex flex-col gap-2 p-4"
                style={{ textDecoration: "none", opacity: 0.85 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className="text-sm font-semibold"
                        style={{ color: "var(--text-primary)", textDecoration: "line-through" }}
                      >
                        {reg.title}
                      </h3>
                      <RegulationCategoryBadge category={reg.category} />
                      <span
                        className="badge"
                        style={{
                          color: "var(--text-muted)",
                          background: "var(--bg-elevated)",
                          borderColor: "var(--border)",
                        }}
                      >
                        v{reg.version}
                      </span>
                    </div>
                  </div>
                  {reg.repealed_date && (
                    <span className="text-xs flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                      廢止於 {new Date(reg.repealed_date).toLocaleDateString("zh-TW")}
                    </span>
                  )}
                </div>
                {reg.published_at && (
                  <p className="text-xs" style={{ color: "var(--text-disabled)" }}>
                    原發布日：{new Date(reg.published_at).toLocaleDateString("zh-TW")}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
