"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  FolderKanban,
  Link2,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { governanceApi } from "@/lib/api";
import type { MatterListItem, MatterLinkRef } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";

type GovernanceEntityType =
  | "document"
  | "meeting"
  | "announcement"
  | "survey"
  | "activity"
  | "regulation"
  | "petition"
  | "judicial_petition"
  | "council_proposal"
  | "election"
  | "order"
  | "org"
  | "vote"
  | "ticket";

const ENTITY_LABEL: Record<GovernanceEntityType, string> = {
  document: "公文",
  meeting: "會議",
  announcement: "公告",
  survey: "問卷",
  activity: "活動",
  regulation: "法規",
  petition: "陳情",
  judicial_petition: "評議",
  council_proposal: "議會提案",
  election: "選舉",
  order: "訂單",
  org: "組織",
  vote: "投票",
  ticket: "售票",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  completed: "完成",
  archived: "歸檔",
  canceled: "取消",
};

/**
 * 模組詳情頁的「納入治理」面板。與舊版相比：
 * - 進場即反向查詢這筆資源已被哪些事情納入，並持久顯示（重新整理不會消失）。
 * - 已納入的事情可直接前往，或解除關聯。
 * - 連動後端 EntityRelation 真實 (target_type, target_id)，是治理匯流的入口。
 */
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
  const [loadingMatters, setLoadingMatters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [matters, setMatters] = useState<MatterListItem[]>([]);
  const [links, setLinks] = useState<MatterLinkRef[]>([]);

  // 反向查詢：這筆資源屬於哪些事情。
  useEffect(() => {
    let alive = true;
    governanceApi
      .linksForTarget(entityType, entityId)
      .then((rows) => {
        if (alive) setLinks(rows);
      })
      .catch(() => {
        /* 詳情頁不因治理查詢失敗而中斷 */
      });
    return () => {
      alive = false;
    };
  }, [entityType, entityId]);

  // 開啟挑選面板時才載入事情清單。
  useEffect(() => {
    if (!open || matters.length > 0 || loadingMatters) return;
    setLoadingMatters(true);
    governanceApi
      .listMatters({ status: "active", limit: 80 })
      .then(setMatters)
      .catch(() => toast.error("無法載入治理事項"))
      .finally(() => setLoadingMatters(false));
  }, [loadingMatters, matters.length, open]);

  const linkedIds = useMemo(() => new Set(links.map((l) => l.matter_id)), [links]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const base = matters.filter((m) => !linkedIds.has(m.id));
    if (!keyword) return base;
    return base.filter(
      (m) =>
        m.title.toLowerCase().includes(keyword) ||
        (m.description ?? "").toLowerCase().includes(keyword),
    );
  }, [matters, query, linkedIds]);

  if (!canManage) return null;

  const linkMatter = async (matter: MatterListItem) => {
    setSaving(true);
    try {
      const relation = await governanceApi.createRelation(matter.id, {
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
      setLinks((prev) => [
        {
          relation_id: relation.id,
          matter_id: matter.id,
          matter_title: matter.title,
          matter_status: matter.status,
          matter_progress: matter.progress_percent,
          relation: "includes",
          case_id: null,
        },
        ...prev,
      ]);
      setOpen(false);
      setQuery("");
      toast.success(`已納入「${matter.title}」`);
    } catch (error) {
      toast.error("建立治理關聯失敗");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const unlink = async (link: MatterLinkRef) => {
    setSaving(true);
    try {
      await governanceApi.deleteRelation(link.relation_id);
      setLinks((prev) => prev.filter((l) => l.relation_id !== link.relation_id));
      toast.success("已解除關聯");
    } catch (error) {
      toast.error("解除關聯失敗");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <span
          key={link.relation_id}
          className={`flex items-center gap-1.5 rounded-md ${compact ? "px-2 py-1" : "px-3 py-1.5"}`}
          style={{
            background: "var(--primary-dim)",
            color: "var(--primary)",
            border: "1px solid var(--info-border)",
          }}
        >
          <Check size={12} aria-hidden={true} />
          <Link
            href={`/governance/${link.matter_id}`}
            className="max-w-[160px] truncate text-xs font-semibold"
            style={{ color: "var(--primary)", textDecoration: "none" }}
            title={link.matter_title}
          >
            {link.matter_title}
          </Link>
          <button
            type="button"
            onClick={() => unlink(link)}
            disabled={saving}
            aria-label={`解除與「${link.matter_title}」的關聯`}
            className="ml-0.5 opacity-70 hover:opacity-100"
          >
            <X size={11} aria-hidden={true} />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={compact ? "btn btn-secondary text-xs" : "btn btn-secondary"}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Link2 size={14} aria-hidden={true} />
        {links.length > 0 ? "再納入" : "納入治理"}
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
          <div
            className="flex items-start justify-between gap-3 p-4"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
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
            {loadingMatters ? (
              <div
                className="flex items-center justify-center gap-2 py-8 text-xs"
                style={{ color: "var(--text-muted)" }}
              >
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
                  className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
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
                    <span
                      className="block truncate text-sm font-medium"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {matter.title}
                    </span>
                    <span
                      className="mt-0.5 block truncate text-xs"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {STATUS_LABEL[matter.status] ?? matter.status} · {matter.progress_percent}% ·{" "}
                      {matter.case_count} 案件
                    </span>
                  </span>
                  {saving ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden={true} />
                  ) : (
                    <ChevronRight
                      size={13}
                      aria-hidden={true}
                      style={{ color: "var(--text-disabled)" }}
                    />
                  )}
                </button>
              ))
            ) : (
              <div
                className="py-8 text-center text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                {matters.length === 0 ? "找不到進行中的事情" : "已全部納入或無相符項目"}
              </div>
            )}
          </div>

          <Link
            href="/governance#quick-create"
            className="flex items-center justify-center gap-1 px-4 py-3 text-xs font-medium"
            style={{
              color: "var(--primary)",
              borderTop: "1px solid var(--border)",
              textDecoration: "none",
            }}
          >
            <Plus size={12} aria-hidden={true} />
            建立新的治理事項
          </Link>
        </div>
      )}
    </div>
  );
}
