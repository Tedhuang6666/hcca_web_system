"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronRight,
  Clock,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { governanceApi } from "@/lib/api";
import type { GovernanceDashboardOut, MatterListItem, MatterPriority, MatterType } from "@/lib/types";

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

const PRIORITY_LABEL: Record<string, string> = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "緊急",
};

function formatDate(value?: string | null) {
  if (!value) return "未設定";
  return new Date(value).toLocaleDateString("zh-TW");
}

function isOverdue(matter: MatterListItem) {
  return Boolean(
    matter.due_at &&
      matter.status === "active" &&
      new Date(matter.due_at).getTime() < new Date().setHours(0, 0, 0, 0),
  );
}

export default function GovernancePage() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<GovernanceDashboardOut | null>(null);
  const [matters, setMatters] = useState<MatterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [matterType, setMatterType] = useState<MatterType>("project");
  const [priority, setPriority] = useState<MatterPriority>("normal");
  const [dueAt, setDueAt] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [summary, list] = await Promise.all([
        governanceApi.dashboard(),
        governanceApi.listMatters({
          q: query || undefined,
          status: status || undefined,
          limit: 100,
        }),
      ]);
      setDashboard(summary);
      setMatters(list);
    } catch (error) {
      toast.error("無法載入治理事項");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const openQuickCreate = () => {
      if (window.location.hash !== "#quick-create") return;
      setShowCreate(true);
      window.requestAnimationFrame(() => {
        document.getElementById("quick-create")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    };
    openQuickCreate();
    window.addEventListener("hashchange", openQuickCreate);
    return () => window.removeEventListener("hashchange", openQuickCreate);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const matter = await governanceApi.createMatter({
        title: title.trim(),
        matter_type: matterType,
        description: null,
        org_id: null,
        owner_user_id: null,
        starts_at: null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        priority,
        visibility: "internal",
        status: "active",
        meta: {},
      });
      setMatters((items) => [
        { ...matter, case_count: 0, open_task_count: 0, link_count: 0 },
        ...items,
      ]);
      setTitle("");
      setDueAt("");
      setShowCreate(false);
      toast.success("事情已建立，接著設定案件、任務或跨模組項目");
      router.push(`/governance/${matter.id}`);
    } catch (error) {
      toast.error("建立失敗");
      console.error(error);
    } finally {
      setCreating(false);
    }
  };

  const stats = dashboard?.stats;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            治理中樞
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            集中追蹤跨模組事項、案件與執行進度
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={14} aria-hidden={true} />
          建立事情
        </button>
      </header>

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="治理摘要">
        <Summary label="進行中" value={stats?.active_matters ?? 0} />
        <Summary label="逾期" value={stats?.overdue_matters ?? 0} danger />
        <Summary label="開放案件" value={stats?.open_cases ?? 0} />
        <Summary label="開放任務" value={stats?.open_tasks ?? 0} />
      </section>

      {showCreate && (
        <section
          id="quick-create"
          className="scroll-mt-24 rounded-lg p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              建立事情
            </h2>
            <button type="button" className="topbar-icon-btn" onClick={() => setShowCreate(false)} aria-label="關閉">
              <X size={14} aria-hidden={true} />
            </button>
          </div>
          <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
            事情是跨模組工作的容器。建立後可在同一頁新增案件、任務、會議、公告與問卷。
          </p>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_auto] md:items-end">
            <Field label="名稱">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="input w-full"
                placeholder="輸入事情名稱"
                required
                autoFocus
              />
            </Field>
            <Field label="類型">
              <select value={matterType} onChange={(event) => setMatterType(event.target.value as MatterType)} className="input w-full">
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="優先級">
              <select value={priority} onChange={(event) => setPriority(event.target.value as MatterPriority)} className="input w-full">
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="預定完成">
              <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="input w-full" />
            </Field>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating && <Loader2 size={13} className="animate-spin" aria-hidden={true} />}
              建立
            </button>
          </form>
        </section>
      )}

      <section
        className="overflow-hidden rounded-lg"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
          className="flex flex-col gap-2 p-3 sm:flex-row"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <label className="relative flex-1">
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
              placeholder="搜尋事情"
            />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="input sm:w-36">
            <option value="">全部狀態</option>
            <option value="active">進行中</option>
            <option value="paused">暫停</option>
            <option value="completed">完成</option>
            <option value="archived">歸檔</option>
          </select>
          <button type="submit" className="btn btn-secondary">篩選</button>
        </form>

        {loading ? (
          <div className="p-10 text-center">
            <Loader2 size={18} className="mx-auto animate-spin" aria-hidden={true} style={{ color: "var(--primary)" }} />
          </div>
        ) : matters.length === 0 ? (
          <div className="p-10 text-center">
            <FolderKanban size={28} className="mx-auto" aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
            <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>沒有符合條件的事情</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {matters.map((matter) => <MatterRow key={matter.id} matter={matter} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg px-4 py-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color: danger && value > 0 ? "var(--danger)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}

function MatterRow({ matter }: { matter: MatterListItem }) {
  const overdue = isOverdue(matter);
  return (
    <Link
      href={`/governance/${matter.id}`}
      className="grid gap-3 px-4 py-3 transition-colors sm:grid-cols-[minmax(0,1fr)_100px_160px_130px_20px] sm:items-center"
      style={{ textDecoration: "none" }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{matter.title}</h2>
          {overdue && <AlertTriangle size={13} aria-label="已逾期" style={{ color: "var(--danger)" }} />}
        </div>
        <p className="mt-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {TYPE_LABEL[matter.matter_type] ?? matter.matter_type} · {PRIORITY_LABEL[matter.priority] ?? matter.priority}
        </p>
      </div>
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {STATUS_LABEL[matter.status] ?? matter.status}
      </span>
      <div>
        <div className="flex justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
          <span>進度</span><span>{matter.progress_percent}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg-hover)" }}>
          <div className="h-full" style={{ width: `${matter.progress_percent}%`, background: "var(--primary)" }} />
        </div>
      </div>
      <span className="flex items-center gap-1 text-xs" style={{ color: overdue ? "var(--danger)" : "var(--text-muted)" }}>
        <Clock size={12} aria-hidden={true} />
        {formatDate(matter.due_at)}
      </span>
      <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
    </Link>
  );
}
