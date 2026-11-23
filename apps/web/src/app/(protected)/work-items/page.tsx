"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  CheckCircle2, Circle, Clock, ExternalLink, Loader2, Plus, RefreshCw,
} from "lucide-react";
import { workItemsApi, googleTasksApi, type WorkItemOut, type GoogleTasksStatus } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/api-cache";

const CACHE_KEY = "work-items/list";

function cacheKey(includeDone: boolean): string {
  return `${CACHE_KEY}/${includeDone ? "all" : "open"}`;
}

type Filter = "open" | "all";

function formatDue(s?: string | null) {
  if (!s) return "";
  const d = new Date(s);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.round(diffMs / (1000 * 60 * 60));
  if (diffMs < 0) {
    const over = Math.abs(diffH);
    return over < 24 ? `逾期 ${over}h` : `逾期 ${Math.round(over / 24)}d`;
  }
  if (diffH < 24) return `${diffH}h 後`;
  return `${Math.round(diffH / 24)}d 後`;
}

export default function WorkItemsPage() {
  const [items, setItems] = useState<WorkItemOut[]>(
    () => cacheGet<WorkItemOut[]>(cacheKey(false)) ?? [],
  );
  const [loading, setLoading] = useState(() => !cacheGet(cacheKey(false)));
  const [filter, setFilter] = useState<Filter>("open");
  const [gtStatus, setGtStatus] = useState<GoogleTasksStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback((showDone = filter === "all") => {
    const key = cacheKey(showDone);
    const cached = cacheGet<WorkItemOut[]>(key);
    if (cached) {
      setItems(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    workItemsApi.list({ include_done: showDone })
      .then((data) => {
        setItems(data);
        cacheSet(key, data, 30_000);
      })
      .catch(() => toast.error("無法載入工作項目"))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    reload();
    googleTasksApi.status().then(setGtStatus).catch(() => null);
  }, [reload]);

  const displayed = useMemo(() => {
    if (filter === "open") return items.filter((i) => i.status === "open");
    return items;
  }, [items, filter]);

  async function handleComplete(id: string) {
    setCompleting(id);
    try {
      const updated = await workItemsApi.complete(id);
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      toast.success("已完成");
    } catch {
      toast.error("操作失敗");
    } finally {
      setCompleting(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await googleTasksApi.sync();
      toast.success(`同步完成：推送 ${result.pushed} 筆，匯入 ${result.pulled_created} 筆`);
      reload();
      const s = await googleTasksApi.status();
      setGtStatus(s);
    } catch {
      toast.error("同步失敗，請至「設定 → 整合」確認授權");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-fg-primary!">我的工作</h1>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {gtStatus?.is_connected ? (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--info-border)] bg-accent-soft! px-3 py-1.5 text-sm font-medium text-accent-text! disabled:opacity-60 sm:w-auto"
            >
              {syncing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden={true} />
              ) : (
                <RefreshCw size={14} aria-hidden={true} />
              )}
              同步 Google Tasks
            </button>
          ) : gtStatus !== null ? (
            <Link
              href="/settings/integrations"
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border! bg-hover! px-3 py-1.5 text-sm font-medium text-fg-muted! no-underline sm:w-auto"
            >
              <ExternalLink size={13} aria-hidden={true} />
              連結 Google Tasks
            </Link>
          ) : null}

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="btn btn-primary min-h-11 w-full sm:w-auto"
          >
            <Plus size={14} aria-hidden={true} />
            新增工作
          </button>
        </div>
      </header>

      {/* 篩選 */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border! bg-surface! p-1">
        {(["open", "all"] as Filter[]).map((f) => {
          const label = f === "open" ? "進行中" : "全部";
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
              }}
              className={`min-h-11 rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${active
                ? "border-[var(--info-border)] bg-accent-soft! text-accent-text!"
                : "border-transparent bg-transparent text-fg-muted!"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {showCreate && (
        <CreateForm
          onCreated={(item) => {
            setItems((prev) => [item, ...prev]);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 size={24} className="animate-spin text-[var(--text-disabled)]" />
        </div>
      ) : displayed.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-border! bg-surface! py-14 text-center">
          <CheckCircle2 size={32} aria-hidden={true}
            className="mb-2.5 inline-block text-[var(--text-disabled)]" />
          <p className="text-sm font-medium text-fg-primary!">
            {filter === "open" ? "沒有進行中的工作" : "沒有工作項目"}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {displayed.map((item) => (
            <WorkRow
              key={item.id}
              item={item}
              completing={completing === item.id}
              onComplete={() => handleComplete(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkRow({
  item,
  completing,
  onComplete,
}: {
  item: WorkItemOut;
  completing: boolean;
  onComplete: () => void;
}) {
  const done = item.status === "done";
  const due = formatDue(item.due_at);
  const isOverdue = item.due_at && new Date(item.due_at) < new Date() && !done;

  return (
    <li
      className={`flex min-w-0 items-start gap-3 rounded-lg border border-border! bg-surface! p-3 sm:p-4 ${done ? "opacity-[0.65]" : "opacity-100"}`}
    >
      <button
        type="button"
        onClick={onComplete}
        disabled={done || completing}
        aria-label={done ? "已完成" : "標記完成"}
        className={`-m-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded disabled:cursor-not-allowed ${done ? "text-success!" : "text-[var(--text-disabled)]"}`}
      >
        {completing ? (
          <Loader2 size={18} className="animate-spin" aria-hidden={true} />
        ) : done ? (
          <CheckCircle2 size={18} aria-hidden={true} />
        ) : (
          <Circle size={18} aria-hidden={true} />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p
          className={`break-words text-sm font-medium text-fg-primary! ${done ? "line-through" : ""}`}
        >
          {item.title}
        </p>
        {item.description && (
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-fg-muted!">
            {item.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {due && (
            <span
              className={`flex items-center gap-1 text-xs ${isOverdue ? "text-danger!" : "text-fg-muted!"}`}
            >
              <Clock size={11} aria-hidden={true} />
              {due}
            </span>
          )}
          {item.google_task_id && (
            <span
              className="rounded border border-[var(--tag-blue-border)] bg-[var(--tag-blue-bg)] px-1.5 py-0.5 text-xs text-[var(--tag-blue-fg)]"
            >
              已同步 Google Tasks
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function CreateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (item: WorkItemOut) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const item = await workItemsApi.create({
        title: title.trim(),
        description: description.trim() || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      });
      onCreated(item);
      toast.success("已建立工作項目");
    } catch {
      toast.error("建立失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-xl border border-[var(--info-border)] bg-surface! p-4"
    >
      <p className="text-sm font-semibold text-fg-primary!">
        新增工作項目
      </p>
      <div className="space-y-2">
        <input
          type="text"
          placeholder="工作標題 *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
          className="min-h-11 w-full rounded-lg border! border-border! bg-[var(--bg-input,var(--bg-muted))] px-3 py-2 text-sm text-fg-primary! outline-none"
        />
        <textarea
          placeholder="說明（選填）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={2}
          className="min-h-24 w-full resize-y rounded-lg border! border-border! bg-[var(--bg-input,var(--bg-muted))] px-3 py-2 text-sm text-fg-primary! outline-none"
        />
        <div>
          <label className="mb-1 block text-xs text-fg-muted!">
            期限（選填）
          </label>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="min-h-11 w-full rounded-lg border! border-border! bg-[var(--bg-input,var(--bg-muted))] px-3 py-2 text-sm text-fg-primary! outline-none"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 w-full rounded-lg border border-border! px-4 py-1.5 text-sm text-fg-muted! sm:w-auto"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="btn btn-primary min-h-11 w-full sm:w-auto"
        >
          {saving ? "建立中…" : "建立"}
        </button>
      </div>
    </form>
  );
}
