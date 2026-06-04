"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  FilePlus2,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  ScrollText,
} from "lucide-react";
import type { CSSProperties } from "react";
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

const priorityOptions: MatterPriority[] = ["normal", "high", "urgent", "low"];
const typeOptions: MatterType[] = [
  "project",
  "activity",
  "regulation",
  "petition",
  "administration",
  "policy",
  "meeting",
  "other",
];

function formatDate(value?: string | null) {
  if (!value) return "未設定";
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function priorityTone(priority: string) {
  if (priority === "urgent") return "var(--danger)";
  if (priority === "high") return "var(--warning)";
  if (priority === "low") return "var(--text-muted)";
  return "var(--primary)";
}

export default function GovernancePage() {
  const [data, setData] = useState<GovernanceDashboardOut | null>(null);
  const [matters, setMatters] = useState<MatterListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [title, setTitle] = useState("");
  const [matterType, setMatterType] = useState<MatterType>("project");
  const [priority, setPriority] = useState<MatterPriority>("normal");
  const [dueAt, setDueAt] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([
      governanceApi.dashboard(),
      governanceApi.listMatters({ q: q || undefined, status: status || undefined, limit: 80 }),
    ])
      .then(([dashboard, list]) => {
        setData(dashboard);
        setMatters(list);
      })
      .catch((error) => {
        toast.error("無法載入治理中樞");
        console.error(error);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => matters, [matters]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    governanceApi
      .createMatter({
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
      })
      .then((matter) => {
        toast.success("已建立事情");
        setTitle("");
        setDueAt("");
        setMatters((prev) => [matterToListItem(matter), ...prev]);
      })
      .catch((error) => {
        toast.error("建立事情失敗");
        console.error(error);
      })
      .finally(() => setCreating(false));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            <FolderKanban size={21} aria-hidden={true} style={{ color: "var(--primary)" }} />
            治理中樞
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            以事情為入口，集中管理案件、任務、決議脈絡與跨模組資料
          </p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            load();
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label className="relative">
            <Search
              size={14}
              aria-hidden={true}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-muted)" }}
            />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="input min-w-[220px] pl-9"
              placeholder="搜尋事情"
            />
          </label>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="input">
            <option value="">全部狀態</option>
            <option value="active">進行中</option>
            <option value="paused">暫停</option>
            <option value="completed">完成</option>
            <option value="archived">歸檔</option>
          </select>
          <button type="submit" className="btn btn-secondary">
            查詢
          </button>
        </form>
      </header>

      <section className="grid gap-3 md:grid-cols-7" aria-label="治理摘要">
        <Metric icon={BriefcaseBusiness} label="進行中事情" value={data?.stats.active_matters ?? 0} />
        <Metric icon={AlertTriangle} label="逾期事情" value={data?.stats.overdue_matters ?? 0} tone="danger" />
        <Metric icon={FolderKanban} label="開放案件" value={data?.stats.open_cases ?? 0} tone="info" />
        <Metric icon={Clock} label="開放任務" value={data?.stats.open_tasks ?? 0} tone="warning" />
        <Metric icon={CheckCircle2} label="我的任務" value={data?.stats.my_tasks ?? 0} tone="success" />
        <Metric icon={ScrollText} label="待執行決議" value={data?.stats.pending_decisions ?? 0} tone="warning" />
        <Metric icon={FilePlus2} label="送審企劃" value={data?.stats.plans_in_review ?? 0} tone="info" />
      </section>

      <section
        className="rounded-lg p-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        aria-label="建立事情"
      >
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-end">
          <label className="space-y-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>事情名稱</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="input w-full"
              placeholder="例如：2026 校慶園遊會"
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>類型</span>
            <select value={matterType} onChange={(event) => setMatterType(event.target.value as MatterType)} className="input w-full">
              {typeOptions.map((item) => (
                <option key={item} value={item}>{TYPE_LABEL[item]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>優先級</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as MatterPriority)} className="input w-full">
              {priorityOptions.map((item) => (
                <option key={item} value={item}>{PRIORITY_LABEL[item]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>預定完成</span>
            <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="input w-full" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? <Loader2 size={14} className="animate-spin" aria-hidden={true} /> : <Plus size={14} aria-hidden={true} />}
            建立
          </button>
        </form>
      </section>

      {loading ? (
        <div className="rounded-lg p-8 text-center" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <Loader2 size={18} className="mx-auto animate-spin" aria-hidden={true} style={{ color: "var(--primary)" }} />
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>載入治理資料中</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg p-10 text-center" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <FolderKanban size={34} className="mx-auto" aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
          <p className="mt-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>目前沒有事情</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>從上方建立第一件事情，後續案件、任務與關聯都會集中到同一頁。</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((matter) => (
            <MatterCard key={matter.id} matter={matter} />
          ))}
        </div>
      )}
    </div>
  );
}

function matterToListItem(matter: Omit<MatterListItem, "case_count" | "open_task_count" | "link_count">): MatterListItem {
  return { ...matter, case_count: 0, open_task_count: 0, link_count: 0 };
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ size: number; "aria-hidden": boolean; style?: CSSProperties }>;
  label: string;
  value: number;
  tone?: "neutral" | "danger" | "info" | "warning" | "success";
}) {
  const color = {
    neutral: "var(--text-primary)",
    danger: "var(--danger)",
    info: "var(--primary)",
    warning: "var(--warning)",
    success: "var(--success)",
  }[tone];
  return (
    <div className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{label}</span>
        <Icon size={15} aria-hidden={true} style={{ color }} />
      </div>
      <p className="mt-3 text-2xl font-semibold leading-none" style={{ color }}>{value}</p>
    </div>
  );
}

function MatterCard({ matter }: { matter: MatterListItem }) {
  return (
    <Link
      href={`/governance/${matter.id}`}
      className="rounded-lg p-4 transition-colors"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", textDecoration: "none" }}
      onMouseEnter={(event) => (event.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(event) => (event.currentTarget.style.background = "var(--bg-surface)")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--info-border)" }}>
              {TYPE_LABEL[matter.matter_type] ?? matter.matter_type}
            </span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "var(--bg-hover)", color: priorityTone(matter.priority), border: "1px solid var(--border)" }}>
              {PRIORITY_LABEL[matter.priority] ?? matter.priority}
            </span>
          </div>
          <h2 className="mt-2 truncate text-base font-semibold" style={{ color: "var(--text-primary)" }}>{matter.title}</h2>
          {matter.description && <p className="mt-1 line-clamp-2 text-sm" style={{ color: "var(--text-muted)" }}>{matter.description}</p>}
        </div>
        <span className="rounded px-2 py-1 text-xs font-medium" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
          {STATUS_LABEL[matter.status] ?? matter.status}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="進度" value={`${matter.progress_percent}%`} />
        <MiniStat label="案件" value={String(matter.case_count)} />
        <MiniStat label="任務" value={String(matter.open_task_count)} />
        <MiniStat label="期限" value={formatDate(matter.due_at)} />
      </div>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2 py-2" style={{ background: "var(--bg-subtle, var(--bg-hover))" }}>
      <p className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}
