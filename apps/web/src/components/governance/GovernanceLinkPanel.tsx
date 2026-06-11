"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  FolderKanban,
  GitBranch,
  Link2,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { governanceApi } from "@/lib/api";
import type { EntityRelationOut, MatterListItem, MatterLinkRef } from "@/lib/types";
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
  | "ticket"
  | "meal_order"
  | "meal_schedule"
  | "calendar_event"
  | "publication"
  | "exam_paper"
  | "receivable"
  | "user"
  | "person"
  | "position"
  | "school_class"
  | "product"
  | "meal_vendor"
  | "partner_business"
  | "email_message"
  | "document_template"
  | "serial_template"
  | "webhook"
  | "api_key"
  | "feature_flag"
  | "policy";

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
  meal_order: "學餐訂單",
  meal_schedule: "學餐排程",
  calendar_event: "行事曆",
  publication: "發布",
  exam_paper: "試卷",
  receivable: "收款",
  user: "使用者",
  person: "人員",
  position: "職位",
  school_class: "班級",
  product: "商品",
  meal_vendor: "餐商",
  partner_business: "特約商家",
  email_message: "郵件",
  document_template: "公文範本",
  serial_template: "字號模板",
  webhook: "Webhook",
  api_key: "API Key",
  feature_flag: "功能旗標",
  policy: "政策文件",
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
 * 模組詳情頁的「納入治理」面板。
 * 顯示目前的 EntityRelation 關聯，並提供前往及解除關聯操作。
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
  const [relations, setRelations] = useState<EntityRelationOut[]>([]);
  const [targetType, setTargetType] = useState<GovernanceEntityType>("document");
  const [targetId, setTargetId] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [targetHref, setTargetHref] = useState("");

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

  useEffect(() => {
    let alive = true;
    governanceApi
      .listEntityRelations(entityType, entityId)
      .then((rows) => {
        if (alive) setRelations(rows);
      })
      .catch(() => {
        /* 不讓整合關聯查詢阻斷模組詳情頁 */
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

  const createDirectRelation = async () => {
    if (!targetId.trim() || !targetTitle.trim()) {
      toast.error("請填寫目標 ID 與名稱");
      return;
    }
    setSaving(true);
    try {
      const relation = await governanceApi.createEntityRelation(entityType, entityId, {
        case_id: null,
        source_type: entityType,
        source_id: entityId,
        target_type: targetType,
        target_id: targetId.trim(),
        relation: "related",
        title: targetTitle.trim(),
        href: targetHref.trim() || null,
        note: `${ENTITY_LABEL[entityType]}與${ENTITY_LABEL[targetType]}直接關聯`,
        meta: { linked_from: "module_detail" },
      });
      setRelations((prev) => [relation, ...prev]);
      setTargetId("");
      setTargetTitle("");
      setTargetHref("");
      toast.success("跨模組關聯已建立");
    } catch (error) {
      toast.error("建立跨模組關聯失敗，請確認目標 ID");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const unlinkDirect = async (relation: EntityRelationOut) => {
    setSaving(true);
    try {
      await governanceApi.deleteRelation(relation.id);
      setRelations((prev) => prev.filter((item) => item.id !== relation.id));
      toast.success("已解除跨模組關聯");
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
      {relations
        .filter((relation) => !(relation.matter_id && relation.source_type === "matter"))
        .map((relation) => (
          <span
            key={relation.id}
            className={`flex items-center gap-1.5 rounded-md ${compact ? "px-2 py-1" : "px-3 py-1.5"}`}
            style={{
              background: "var(--bg-hover)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            <GitBranch size={12} aria-hidden={true} />
            {relation.source_type === entityType &&
            relation.source_id === entityId &&
            relation.href ? (
              <Link
                href={relation.href}
                className="max-w-[160px] truncate text-xs font-semibold"
                title={relation.title}
              >
                {ENTITY_LABEL[relation.target_type as GovernanceEntityType] ??
                  relation.target_type}
                ：{relation.title}
              </Link>
            ) : (
              <span className="max-w-[160px] truncate text-xs" title={relation.title}>
                {relation.source_type === entityType && relation.source_id === entityId
                  ? `${ENTITY_LABEL[relation.target_type as GovernanceEntityType] ?? relation.target_type}：${relation.title}`
                  : `來自 ${ENTITY_LABEL[relation.source_type as GovernanceEntityType] ?? relation.source_type}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => unlinkDirect(relation)}
              disabled={saving}
              aria-label={`解除與「${relation.title}」的關聯`}
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
                className="input w-full"
                style={{ paddingLeft: "2.25rem" }}
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

          <div className="space-y-2 p-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div>
              <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                直接連到其他模組
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                建立任意模組實體間的關聯，不必先建立治理事情。
              </p>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <select
                value={targetType}
                onChange={(event) =>
                  setTargetType(event.target.value as GovernanceEntityType)
                }
                className="input"
              >
                {Object.entries(ENTITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <input
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className="input"
                placeholder="目標資料 ID"
              />
            </div>
            <input
              value={targetTitle}
              onChange={(event) => setTargetTitle(event.target.value)}
              className="input w-full"
              placeholder="關聯項目名稱"
            />
            <input
              value={targetHref}
              onChange={(event) => setTargetHref(event.target.value)}
              className="input w-full"
              placeholder="前往網址，例如 /documents/..."
            />
            <button
              type="button"
              className="btn btn-secondary w-full justify-center"
              onClick={createDirectRelation}
              disabled={saving}
            >
              <GitBranch size={13} aria-hidden={true} />
              建立跨模組關聯
            </button>
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
