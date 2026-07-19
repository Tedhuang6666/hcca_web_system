"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { mattersApi } from "@/lib/api";
import type { MatterListItem, MatterPriority, MatterType } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  activity: "活動",
  policy: "政策",
  regulation: "法規",
  petition: "陳情",
  meeting: "會議",
  administration: "行政",
  project: "專案",
  other: "其他",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  completed: "完成",
  archived: "歸檔",
  canceled: "取消",
};

function formatDate(value?: string | null) {
  if (!value) return "未設定";
  return new Date(value).toLocaleDateString("zh-TW");
}

export default function MattersPage() {
  const [items, setItems] = useState<MatterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [matterType, setMatterType] = useState<MatterType>("project");
  const [priority, setPriority] = useState<MatterPriority>("normal");

  async function load() {
    setLoading(true);
    try {
      setItems(await mattersApi.list({ q: query || undefined, limit: 100 }));
    } catch (error) {
      toast.error("無法載入事項");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const matter = await mattersApi.create({
        title: title.trim(),
        matter_type: matterType,
        description: null,
        org_id: null,
        owner_user_id: null,
        starts_at: null,
        due_at: null,
        priority,
        visibility: "internal",
        status: "active",
        meta: {},
      });
      setItems((current) => [
        { ...matter, case_count: 0, open_task_count: 0, link_count: 0 },
        ...current,
      ]);
      setTitle("");
      toast.success("事項已建立");
    } catch (error) {
      toast.error("建立事項失敗");
      console.error(error);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="matters-page mx-auto max-w-6xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            整合工作台
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            用同一個事項串起會議、公文、法規、公告、任務與外部協作資源
          </p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="input w-56 pl-8"
              placeholder="搜尋事項"
            />
          </div>
          <button type="submit" className="btn">搜尋</button>
        </form>
      </header>

      <form
        onSubmit={submit}
        className="grid gap-3 rounded-lg p-4 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_auto]"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <label className="space-y-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>事項名稱</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="input w-full"
            placeholder="例如：學生餐廳滿意度改善"
            required
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>類型</span>
          <select
            value={matterType}
            onChange={(event) => setMatterType(event.target.value as MatterType)}
            className="input w-full"
          >
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>優先度</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as MatterPriority)}
            className="input w-full"
          >
            <option value="normal">普通</option>
            <option value="high">高</option>
            <option value="urgent">緊急</option>
            <option value="low">低</option>
          </select>
        </label>
        <button type="submit" className="btn btn-primary self-end" disabled={creating}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          建立
        </button>
      </form>

      <section className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={16} className="animate-spin" />
            載入中
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg p-6 text-sm" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
            目前沒有符合條件的事項。
          </div>
        ) : (
          items.map((matter) => (
            <Link
              key={matter.id}
              href={`/matters/${matter.id}`}
              className="block rounded-lg p-4 transition hover:translate-x-0.5"
              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>
                      {TYPE_LABEL[matter.matter_type] ?? matter.matter_type}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {STATUS_LABEL[matter.status] ?? matter.status}
                    </span>
                  </div>
                  <h2 className="mt-1 truncate text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                    {matter.title}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays size={13} />
                      期限 {formatDate(matter.due_at)}
                    </span>
                    <span>{matter.link_count} 個關聯</span>
                    <span>{matter.open_task_count} 個待辦</span>
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-muted)" }} />
              </div>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
