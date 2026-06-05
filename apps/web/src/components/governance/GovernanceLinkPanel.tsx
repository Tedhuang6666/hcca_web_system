"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, FolderKanban, Link2, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { governanceApi } from "@/lib/api";
import type { MatterListItem } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

type GovernanceEntityType =
  | "document"
  | "meeting"
  | "announcement"
  | "survey"
  | "event"
  | "regulation"
  | "petition"
  | "vote"
  | "ticket";

const ENTITY_LABEL: Record<GovernanceEntityType, string> = {
  document: "公文",
  meeting: "會議",
  announcement: "公告",
  survey: "問卷",
  event: "活動",
  regulation: "法規",
  petition: "陳情",
  vote: "投票",
  ticket: "售票",
};

export default function GovernanceLinkPanel({
  entityType,
  entityId,
  title,
  href,
  compact = false,
}: {
  entityType: GovernanceEntityType;
  entityId: string;
  title: string;
  href: string;
  compact?: boolean;
}) {
  const { canAny } = usePermissions();
  const canManage = canAny(
    "governance:manage",
    "meeting:manage",
    "activity:manage",
    "document:admin",
    "admin:all",
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [matters, setMatters] = useState<MatterListItem[]>([]);
  const [linkedMatter, setLinkedMatter] = useState<MatterListItem | null>(null);

  useEffect(() => {
    if (!open || matters.length > 0 || loading) return;
    setLoading(true);
    governanceApi
      .listMatters({ status: "active", limit: 80 })
      .then(setMatters)
      .catch(() => toast.error("無法載入治理事項"))
      .finally(() => setLoading(false));
  }, [loading, matters.length, open]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return matters;
    return matters.filter(
      (matter) =>
        matter.title.toLowerCase().includes(keyword) ||
        (matter.description ?? "").toLowerCase().includes(keyword),
    );
  }, [matters, query]);

  if (!canManage) return null;

  const linkMatter = async (matter: MatterListItem) => {
    setSaving(true);
    try {
      await governanceApi.createRelation(matter.id, {
        case_id: null,
        source_type: "matter",
        source_id: matter.id,
        target_type: entityType,
        target_id: entityId,
        relation: "includes",
        title,
        href,
        note: `${ENTITY_LABEL[entityType]}已從原模組頁面納入治理事項`,
        meta: { linked_from: "module_detail" },
      });
      setLinkedMatter(matter);
      setOpen(false);
      toast.success(`已納入「${matter.title}」`);
    } catch (error) {
      toast.error("建立治理關聯失敗");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  if (linkedMatter) {
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-md ${compact ? "px-3 py-2" : "p-3"}`}
        style={{
          background: "var(--primary-dim)",
          color: "var(--primary)",
          border: "1px solid var(--info-border)",
        }}
      >
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <Check size={14} aria-hidden={true} />
          <span className="truncate">已納入：{linkedMatter.title}</span>
        </span>
        <Link
          href={`/governance/${linkedMatter.id}`}
          className="flex flex-shrink-0 items-center gap-1 text-xs font-semibold"
          style={{ color: "var(--primary)", textDecoration: "none" }}
        >
          查看
          <ChevronRight size={12} aria-hidden={true} />
        </Link>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={compact ? "btn btn-secondary text-xs" : "btn btn-secondary"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Link2 size={14} aria-hidden={true} />
        納入治理
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`將${ENTITY_LABEL[entityType]}納入治理事項`}
          className="absolute right-0 top-full z-40 mt-2 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-xl)",
          }}
        >
          <div className="flex items-start justify-between gap-3 p-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                納入治理事項
              </p>
              <p className="mt-1 line-clamp-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {ENTITY_LABEL[entityType]}：{title}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="topbar-icon-btn"
              aria-label="關閉"
            >
              <X size={14} aria-hidden={true} />
            </button>
          </div>

          <div className="p-3">
            <label className="relative block">
              <Search
                size={14}
                aria-hidden={true}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="input w-full pl-9"
                placeholder="搜尋進行中的事情"
                autoFocus
              />
            </label>
          </div>

          <div className="max-h-72 overflow-y-auto px-2 pb-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs" style={{ color: "var(--text-muted)" }}>
                <Loader2 size={14} className="animate-spin" aria-hidden={true} />
                載入治理事項
              </div>
            ) : filtered.length > 0 ? (
              filtered.map((matter) => (
                <button
                  key={matter.id}
                  type="button"
                  onClick={() => linkMatter(matter)}
                  disabled={saving}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors"
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
                  {saving ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden={true} />
                  ) : (
                    <ChevronRight size={13} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
                  )}
                </button>
              ))
            ) : (
              <div className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                找不到進行中的事情
              </div>
            )}
          </div>

          <Link
            href="/governance#quick-create"
            className="flex items-center justify-center gap-1 px-4 py-3 text-xs font-medium"
            style={{ color: "var(--primary)", borderTop: "1px solid var(--border)", textDecoration: "none" }}
          >
            建立新的治理事項
            <ChevronRight size={12} aria-hidden={true} />
          </Link>
        </div>
      )}
    </div>
  );
}
