"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { auditLogsApi, usersApi, type UserSummary, apiErrorMessage } from "@/lib/api";
import type { AuditLogOut } from "@/lib/types";
import { usePermissions } from "@/hooks/usePermissions";
import Modal from "@/components/ui/Modal";
import { cacheGet, cacheHas, cacheSet } from "@/lib/api-cache";

const PAGE_SIZE = 50;

const ENTITY_LABELS: Record<string, string> = {
  document: "公文",
  regulation: "法規",
  user: "使用者",
  permission: "權限",
  org: "組織",
  position: "職位",
  announcement: "公告",
  announcement_media: "公告媒體",
  shop: "商品",
  product: "商品",
  order: "訂單",
  meal: "學餐",
  meal_vendor: "學餐商家",
  meal_schedule: "學餐排程",
  meal_item: "學餐品項",
  meal_order: "學餐訂單",
  survey: "問卷",
  survey_question: "問卷題目",
  survey_response: "問卷填答",
  serial_template: "字號模板",
  regulation_article: "法規條文",
  user_position: "使用者任期",
};

const AUDIT_SYSTEMS = [
  { key: "admin", label: "管理與權限", entities: ["user", "user_position", "position", "permission"] },
  { key: "org", label: "組織", entities: ["org", "position", "user_position", "permission"] },
  { key: "document", label: "公文", entities: ["document", "document_attachment", "serial_template"] },
  { key: "serial", label: "字號模板", entities: ["serial_template"] },
  { key: "regulation", label: "法規", entities: ["regulation", "regulation_article"] },
  { key: "announcement", label: "公告", entities: ["announcement", "announcement_media"] },
  { key: "shop", label: "商品訂購", entities: ["product", "order", "shop"] },
  { key: "meal", label: "學餐", entities: ["meal_vendor", "meal_schedule", "meal_item", "meal_order"] },
  { key: "survey", label: "問卷", entities: ["survey", "survey_question", "survey_response"] },
] as const;

const ACTION_LABELS: Record<string, string> = {
  create: "建立",
  update: "更新",
  edit: "編輯",
  delete: "刪除",
  submit: "送審",
  approve: "核准",
  reject: "退回",
  publish: "發布",
  unpublish: "取消發布",
  archive: "封存",
  login: "登入",
  logout: "登出",
  assign: "指派",
  remove: "移除",
  "user.pre_register": "預建使用者",
  "user.update": "更新使用者",
  "position.create": "建立職位",
  "position.update": "更新職位",
  "position.delete": "刪除職位",
  "position.assign": "指派職位",
  "position.unassign": "移除職位",
  "position.term_update": "更新任期",
  "permission.assign": "指派權限",
  "permission.remove": "移除權限",
  "permission.replace": "整批更新權限",
  "org.create": "建立組織",
  "org.update": "更新組織",
  "org.delete": "刪除組織",
  "serial.create": "建立字號模板",
  "serial.update": "更新字號模板",
  "serial.deactivate": "停用字號模板",
  "serial.set_default": "設為一般預設字號",
  "serial.set_president_default": "設為主席公告預設",
  "survey.create": "建立問卷",
  "survey.update": "更新問卷",
  "survey.open": "開放問卷",
  "survey.close": "關閉問卷",
  "survey.question_create": "新增問卷題目",
  "survey.question_update": "修改問卷題目",
  "survey.question_delete": "刪除問卷題目",
  "survey.response_submit": "提交問卷填答",
  "regulation.create": "建立法規",
  "regulation.update": "更新法規",
  "regulation.publish": "發布法規",
  "regulation.archive": "停用法規",
  "regulation.freeze": "凍結法規",
  "regulation.unfreeze": "解凍法規",
  "regulation.fork_draft": "分支法規草案",
  "regulation.article_create": "新增法規條文",
  "regulation.article_update": "修改法規條文",
  "regulation.article_move": "移動法規條文",
  "regulation.article_delete": "刪除法規條文",
  "regulation.article_reorder": "重排法規條文",
  "regulation.article_auto_renumber": "重編法規條號",
  "regulation.workflow_under_review": "法規送審",
  "regulation.workflow_scheduled": "排入議程",
  "regulation.workflow_council_approved": "議會核定",
  "regulation.workflow_published": "主席公布",
  "regulation.workflow_draft": "退回草稿",
  "regulation.workflow_rejected": "退回法規",
  "announcement.create": "建立公告",
  "announcement.update": "更新公告",
  "announcement.publish": "發布公告",
  "announcement.unpublish": "取消發布公告",
  "announcement.set_urgent": "設定緊急公告",
  "announcement.delete": "刪除公告",
  "announcement.media_upload": "上傳公告媒體",
  "announcement.media_delete": "刪除公告媒體",
  "shop.product_create": "建立商品",
  "shop.product_update": "更新商品",
  "shop.product_activate": "上架商品",
  "shop.product_deactivate": "下架商品",
  "shop.order_create": "建立商品訂單",
  "shop.order_cancel": "取消商品訂單",
  "meal.vendor_create": "建立學餐商家",
  "meal.vendor_update": "更新學餐商家",
  "meal.vendor_manager_assign": "指派商家管理員",
  "meal.schedule_create": "建立學餐排程",
  "meal.schedule_update": "更新學餐排程",
  "meal.schedule_close": "學餐結單",
  "meal.item_create": "新增學餐品項",
  "meal.item_update": "更新學餐品項",
  "meal.item_delete": "刪除學餐品項",
  "meal.order_create": "建立學餐訂單",
  "meal.order_cancel": "取消學餐訂單",
  "meal.order_confirm": "確認學餐訂單",
  "meal.order_complete": "完成學餐訂單",
};

const COMMON_ACTIONS = [
  "user.pre_register",
  "user.update",
  "org.create",
  "org.update",
  "permission.assign",
  "permission.replace",
  "position.assign",
  "serial.create",
  "serial.update",
  "serial.set_default",
  "serial.set_president_default",
  "survey.create",
  "survey.update",
  "survey.open",
  "survey.close",
  "regulation.create",
  "regulation.update",
  "announcement.publish",
  "shop.order_create",
  "meal.order_create",
];

function actionBelongsToSystem(action: string, system: string) {
  if (!system) return true;
  if (system === "admin") {
    return action.startsWith("user.")
      || action.startsWith("position.")
      || action.startsWith("permission.");
  }
  if (system === "org") {
    return action.startsWith("org.")
      || action.startsWith("position.")
      || action.startsWith("permission.");
  }
  if (system === "document") return action.startsWith("document.") || action === "create";
  if (system === "serial") return action.startsWith("serial.");
  if (system === "regulation") return action.startsWith("regulation.");
  if (system === "announcement") return action.startsWith("announcement.");
  if (system === "shop") return action.startsWith("shop.");
  if (system === "meal") return action.startsWith("meal.");
  if (system === "survey") return action.startsWith("survey.");
  return true;
}

function actionTone(action: string) {
  if (
    action.includes("delete")
    || action.includes("remove")
    || action.includes("cancel")
    || action.includes("reject")
    || action.includes("archive")
    || action.includes("deactivate")
    || action.includes("unassign")
  ) {
    return {
      background: "rgba(239,68,68,0.12)",
      color: "var(--danger)",
      border: "1px solid var(--danger-border)",
    };
  }
  if (
    action.includes("approve")
    || action.includes("publish")
    || action.includes("open")
    || action.includes("complete")
    || action.includes("confirm")
    || action.includes("activate")
    || action.includes("set_default")
  ) {
    return {
      background: "rgba(34,197,94,0.12)",
      color: "var(--success)",
      border: "1px solid var(--success-border)",
    };
  }
  if (
    action.includes("update")
    || action.includes("edit")
    || action.includes("move")
    || action.includes("reorder")
    || action.includes("renumber")
    || action.includes("term_update")
  ) {
    return {
      background: "rgba(59,130,246,0.12)",
      color: "#3b82f6",
      border: "1px solid rgba(59,130,246,0.28)",
    };
  }
  if (
    action.includes("assign")
    || action.includes("submit")
    || action.includes("schedule")
    || action.includes("freeze")
    || action.includes("urgent")
  ) {
    return {
      background: "rgba(245,158,11,0.12)",
      color: "var(--warning)",
      border: "1px solid var(--warning-border)",
    };
  }
  return {
    background: "var(--primary-dim)",
    color: "var(--primary)",
    border: "1px solid var(--border-strong)",
  };
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatFullDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

function entityLabel(entityType: string) {
  return ENTITY_LABELS[entityType] ?? entityType;
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function MetaPreview({ meta }: { meta: Record<string, unknown> }) {
  const entries = Object.entries(meta).slice(0, 3);
  if (entries.length === 0) {
    return <span style={{ color: "var(--text-muted)" }}>無附加資料</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="rounded-md px-2 py-1 text-[11px]"
          style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
          {key}: {typeof value === "object" ? JSON.stringify(value) : String(value)}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  return (
    <div className="card flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </div>
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {loading ? "正在載入稽核日誌" : "沒有符合條件的紀錄"}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {loading ? "請稍候" : "調整操作類型、使用者或日期範圍後再試一次"}
        </p>
      </div>
    </div>
  );
}

const AUDIT_LIST_KEY = "audit-logs/list";

export default function AuditLogsPage() {
  const { can } = usePermissions();
  const canView = can("audit:view_org") || can("audit:view_all") || can("admin:all");

  const [logs, setLogs] = useState<AuditLogOut[]>(() => cacheGet<AuditLogOut[]>(AUDIT_LIST_KEY) ?? []);
  const [loading, setLoading] = useState(!cacheHas(AUDIT_LIST_KEY));
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [system, setSystem] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actor, setActor] = useState<UserSummary | null>(null);
  const [actorKeyword, setActorKeyword] = useState("");
  const [actorOptions, setActorOptions] = useState<UserSummary[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogOut | null>(null);
  const [exporting, setExporting] = useState(false);

  const actionOptions = useMemo(() => {
    const loaded = logs.map((log) => log.action);
    return Array.from(new Set([...COMMON_ACTIONS, ...loaded]))
      .filter((item) => actionBelongsToSystem(item, system))
      .sort((a, b) => actionLabel(a).localeCompare(actionLabel(b), "zh-Hant"));
  }, [logs, system]);

  const entityOptions = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.entity_type))).sort();
  }, [logs]);

  const actorId = actor?.id;
  const activeFilterCount = [system, action, entityType, dateFrom, dateTo, actor?.id].filter(Boolean).length;

  const loadLogs = useCallback(async (nextOffset = 0, append = false) => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const hasFilters = !!(action || system || entityType || actorId || dateFrom || dateTo);
    const hasCached = cacheHas(AUDIT_LIST_KEY);
    if (append) setLoadingMore(true);
    else if (!hasCached || hasFilters) setLoading(true);

    try {
      const data = await auditLogsApi.list({
        action: action || undefined,
        system: system || undefined,
        entity_type: entityType || undefined,
        actor_id: actorId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setLogs((prev) => (append ? [...prev, ...data] : data));
      setOffset(nextOffset);
      setHasMore(data.length === PAGE_SIZE);
      if (!append && !hasFilters && nextOffset === 0) {
        cacheSet(AUDIT_LIST_KEY, data);
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, "載入稽核日誌失敗"));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [action, actorId, canView, dateFrom, dateTo, entityType, system]);

  useEffect(() => {
    loadLogs(0, false);
  }, [loadLogs]);

  useEffect(() => {
    const keyword = actorKeyword.trim();
    if (keyword.length < 2) {
      setActorOptions([]);
      return;
    }

    let cancelled = false;
    setSearchingUsers(true);
    const timer = window.setTimeout(() => {
      usersApi
        .listForSearch(keyword)
        .then((users) => {
          if (!cancelled) setActorOptions(users.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setActorOptions([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingUsers(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [actorKeyword]);

  const resetFilters = () => {
    setAction("");
    setSystem("");
    setEntityType("");
    setDateFrom("");
    setDateTo("");
    setActor(null);
    setActorKeyword("");
    setActorOptions([]);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(auditLogsApi.exportCsvUrl({
        action: action || undefined,
        system: system || undefined,
        entity_type: entityType || undefined,
        actor_id: actorId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: 5000,
      }), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.success("CSV 已匯出");
    } catch (e) {
      toast.error(e instanceof Error && e.message ? `匯出失敗：${e.message}` : "匯出失敗");
    } finally {
      setExporting(false);
    }
  };

  if (!canView) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState loading={false} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
            AUDIT TRAIL
          </p>
          <h1 className="mt-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            稽核日誌
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            查看所有操作軌跡
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={exportCsv} disabled={exporting || loading}>
            匯出 CSV
          </button>
          <button className="btn btn-secondary" onClick={() => loadLogs(0, false)} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M3 21v-5h5" />
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M16 8h5V3" />
            </svg>
            重新整理
          </button>
        </div>
      </header>

      <section className="card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>系統</span>
            <select
              className="input"
              value={system}
              onChange={(e) => {
                setSystem(e.target.value);
                setEntityType("");
                setAction("");
              }}>
              <option value="">全部系統</option>
              {AUDIT_SYSTEMS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>操作類型</span>
            <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">全部操作</option>
              {actionOptions.map((item) => (
                <option key={item} value={item}>{actionLabel(item)}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>起始日期</span>
            <input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>

          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>結束日期</span>
            <input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>

          <div className="flex items-end">
            <button className="btn btn-ghost w-full" onClick={resetFilters} disabled={activeFilterCount === 0}>
              清除篩選
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto]">
          <label className="space-y-1.5">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>資源種類</span>
            <select
              className="input"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              disabled={Boolean(system)}>
              <option value="">{system ? "依系統自動篩選" : "全部資源"}</option>
              {entityOptions.map((item) => (
                <option key={item} value={item}>{entityLabel(item)}</option>
              ))}
            </select>
          </label>

          <div className="relative">
            <label className="space-y-1.5">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>使用者</span>
              <input
                className="input"
                type="search"
                value={actorKeyword}
                onChange={(e) => {
                  setActorKeyword(e.target.value);
                  setActor(null);
                }}
                placeholder="輸入姓名或 email 篩選操作者"
              />
            </label>
            {(actorOptions.length > 0 || searchingUsers) && !actor && (
              <div
                className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg shadow-lg"
                role="listbox"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                {searchingUsers ? (
                  <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>搜尋中</p>
                ) : actorOptions.map((user) => (
                  <button
                    key={user.id}
                    className="block w-full px-3 py-2 text-left text-sm transition-colors hover:opacity-80"
                    role="option"
                    aria-selected={false}
                    style={{ color: "var(--text-primary)", borderBottom: "1px solid var(--border)" }}
                    onClick={() => {
                      setActor(user);
                      setActorKeyword(`${user.display_name} · ${user.email}`);
                      setActorOptions([]);
                    }}>
                    <span className="font-medium">{user.display_name}</span>
                    <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>{user.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className="flex items-end justify-between gap-3 rounded-lg px-3 py-2 lg:min-w-56"
            style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
            <div>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>目前結果</p>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {logs.length} 筆{hasMore ? "+" : ""}
              </p>
            </div>
            {activeFilterCount > 0 && (
              <span
                className="rounded-full px-2 py-1 text-xs font-medium"
                style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                {activeFilterCount} 個篩選
              </span>
            )}
          </div>
        </div>
      </section>

      {loading && logs.length === 0 ? (
        <EmptyState loading />
      ) : logs.length === 0 ? (
        <EmptyState loading={false} />
      ) : (
        <section className="table-container">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="table-header">
                <tr>
                  <th>時間</th>
                  <th>操作</th>
                  <th>操作者</th>
                  <th>資源</th>
                  <th>摘要</th>
                  <th>來源</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="table-row" onClick={() => setSelectedLog(log)}>
                    <td className="whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    <td>
                      <span
                        className="inline-flex rounded-full px-2.5 py-1 text-xs font-medium"
                        style={actionTone(log.action)}>
                        {actionLabel(log.action)}
                      </span>
                    </td>
                    <td>
                      <div className="min-w-40">
                        <p className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                          {log.actor_email ?? "系統"}
                        </p>
                        {log.actor_id && (
                          <p className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {shortId(log.actor_id)}
                          </p>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="min-w-32">
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {entityLabel(log.entity_type)}
                        </p>
                        <p className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {shortId(log.entity_id)}
                        </p>
                      </div>
                    </td>
                    <td className="min-w-72">
                      <p className="line-clamp-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                        {log.summary || `${entityLabel(log.entity_type)} ${actionLabel(log.action)}`}
                      </p>
                      <div className="mt-1">
                        <MetaPreview meta={log.meta} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {log.ip_address ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            className="btn btn-ghost"
            onClick={() => loadLogs(offset + PAGE_SIZE, true)}
            disabled={loadingMore}>
            {loadingMore ? "載入中" : "載入更多"}
          </button>
        </div>
      )}

      {selectedLog && (
        <Modal
          title={selectedLog.summary || `${entityLabel(selectedLog.entity_type)}操作紀錄`}
          onClose={() => setSelectedLog(null)}
          size="2xl"
        >
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
                {actionLabel(selectedLog.action)}
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {formatFullDateTime(selectedLog.created_at)}
              </p>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["操作者", selectedLog.actor_email ?? "系統"],
                ["使用者 ID", selectedLog.actor_id ?? "-"],
                ["資源種類", entityLabel(selectedLog.entity_type)],
                ["資源 ID", selectedLog.entity_id],
                ["IP 位址", selectedLog.ip_address ?? "-"],
                ["日誌 ID", selectedLog.id],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg p-3" style={{ background: "var(--bg-hover)" }}>
                  <dt className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>{label}</dt>
                  <dd className="mt-1 break-all text-sm" style={{ color: "var(--text-primary)" }}>{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="mb-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>附加資料</p>
              <pre
                className="max-h-72 overflow-auto rounded-lg p-3 text-xs leading-relaxed"
                style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
                {JSON.stringify(selectedLog.meta, null, 2)}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
