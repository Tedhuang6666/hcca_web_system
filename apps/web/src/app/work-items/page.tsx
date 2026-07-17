"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, Circle, Clock, ExternalLink, Loader2, Plus, RefreshCw,
} from "lucide-react";
import { workItemsApi, googleTasksApi, type WorkItemOut, type GoogleTasksStatus } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/api-cache";

const CACHE_KEY = "work-items/list";

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
  const [items, setItems] = useState<WorkItemOut[]>(() => cacheGet<WorkItemOut[]>(CACHE_KEY) ?? []);
  const [loading, setLoading] = useState(!cacheGet(CACHE_KEY));
  const [filter, setFilter] = useState<Filter>("open");
  const [gtStatus, setGtStatus] = useState<GoogleTasksStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function reload(showDone = filter === "all") {
    setLoading(true);
    workItemsApi.list({ include_done: showDone })
      .then((data) => {
        setItems(data);
        cacheSet(CACHE_KEY, data, 30_000);
      })
      .catch(() => toast.error("無法載入工作項目"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    googleTasksApi.status().then(setGtStatus).catch(() => null);
  }, []);

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
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            我的工作
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            個人工作項目管理，可與 Google Tasks 同步
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {gtStatus?.is_connected ? (
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              style={{
                background: "var(--primary-dim)",
                color: "var(--primary)",
                border: "1px solid var(--info-border)",
              }}
            >
              {syncing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden={true} />
              ) : (
                <RefreshCw size={14} aria-hidden={true} />
              )}
              同步 Google Tasks
            </button>
          ) : gtStatus !== null ? (
            <a
              href="/settings/integrations"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{
                background: "var(--bg-hover)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                textDecoration: "none",
              }}
            >
              <ExternalLink size={13} aria-hidden={true} />
              連結 Google Tasks
            </a>
          ) : null}

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium"
            style={{ background: "var(--primary)", color: "#fff" }}
          >
            <Plus size={14} aria-hidden={true} />
            新增工作
          </button>
        </div>
      </header>

      {/* 篩選 */}
      <div className="flex gap-0.5 p-1 rounded-xl overflow-x-auto"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        {(["open", "all"] as Filter[]).map((f) => {
          const label = f === "open" ? "進行中" : "全部";
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => {
                setFilter(f);
                reload(f === "all");
              }}
              className="flex-shrink-0 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: active ? "var(--primary-dim)" : "transparent",
                color: active ? "var(--primary)" : "var(--text-muted)",
                border: active ? "1px solid var(--info-border)" : "1px solid transparent",
              }}
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
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-disabled)" }} />
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-14"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
          <CheckCircle2 size={32} aria-hidden={true}
            style={{ color: "var(--text-disabled)", display: "inline-block", marginBottom: 10 }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {filter === "open" ? "沒有進行中的工作" : "沒有工作項目"}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            點右上角「新增工作」建立第一筆
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
      className="flex items-start gap-3 p-4 rounded-lg"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        opacity: done ? 0.65 : 1,
      }}
    >
      <button
        type="button"
        onClick={onComplete}
        disabled={done || completing}
        aria-label={done ? "已完成" : "標記完成"}
        className="-m-2 flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded disabled:cursor-not-allowed"
        style={{ color: done ? "var(--success)" : "var(--text-disabled)" }}
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
          className="text-sm font-medium"
          style={{
            color: "var(--text-primary)",
            textDecoration: done ? "line-through" : "none",
          }}
        >
          {item.title}
        </p>
        {item.description && (
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
            {item.description}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {due && (
            <span
              className="text-[11px] flex items-center gap-1"
              style={{ color: isOverdue ? "var(--danger)" : "var(--text-muted)" }}
            >
              <Clock size={11} aria-hidden={true} />
              {due}
            </span>
          )}
          {item.google_task_id && (
            <span
              className="text-[11px] px-1.5 py-0.5 rounded"
              style={{
                background: "#e8f0fe",
                color: "#1a73e8",
                border: "1px solid #c5d8ff",
              }}
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
      className="rounded-xl p-4 space-y-3"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--info-border)" }}
    >
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
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
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{
            background: "var(--bg-input, var(--bg-muted))",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <textarea
          placeholder="說明（選填）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          rows={2}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
          style={{
            background: "var(--bg-input, var(--bg-muted))",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
          }}
        />
        <div>
          <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>
            期限（選填）
          </label>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "var(--bg-input, var(--bg-muted))",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-1.5 text-sm"
          style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
        >
          取消
        </button>
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="rounded-lg px-4 py-1.5 text-sm font-medium disabled:opacity-60"
          style={{ background: "var(--primary)", color: "#fff" }}
        >
          {saving ? "建立中…" : "建立"}
        </button>
      </div>
    </form>
  );
}
