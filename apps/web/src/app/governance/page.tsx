"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  FilePlus2,
  Filter,
  FolderKanban,
  GitBranch,
  LayoutList,
  Loader2,
  Plus,
  Search,
  ScrollText,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
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

const matterPresets: Array<{
  title: string;
  type: MatterType;
  priority: MatterPriority;
  description: string;
  icon: ComponentType<IconProps>;
}> = [
  {
    title: "校慶活動",
    type: "activity",
    priority: "high",
    description: "建立企劃、組織、售票、公告、問卷與成果報告的活動中心。",
    icon: Sparkles,
  },
  {
    title: "法規修正",
    type: "regulation",
    priority: "normal",
    description: "追蹤草案、審議、表決、公告與版本歷史。",
    icon: ScrollText,
  },
  {
    title: "陳情處理",
    type: "petition",
    priority: "high",
    description: "集中陳情內容、承辦案件、回覆任務與處理時間軸。",
    icon: AlertTriangle,
  },
  {
    title: "決議追蹤",
    type: "meeting",
    priority: "normal",
    description: "把會議決議拆成可執行任務，避免會後失散。",
    icon: GitBranch,
  },
];

type IconProps = { size: number; "aria-hidden": boolean; style?: CSSProperties };

function formatDate(value?: string | null) {
  if (!value) return "未設定";
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function isPast(value?: string | null) {
  if (!value) return false;
  const due = new Date(value).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today.getTime();
}

function priorityTone(priority: string) {
  if (priority === "urgent") return "var(--danger)";
  if (priority === "high") return "var(--warning)";
  if (priority === "low") return "var(--text-muted)";
  return "var(--primary)";
}

function progressTone(value: number) {
  if (value >= 80) return "var(--success)";
  if (value >= 45) return "var(--primary)";
  return "var(--warning)";
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

  const statusCounts = useMemo(() => {
    return matters.reduce<Record<string, number>>((acc, matter) => {
      acc[matter.status] = (acc[matter.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [matters]);

  const atRiskMatters = useMemo(() => {
    return matters
      .filter(
        (matter) =>
          matter.status === "active" &&
          (isPast(matter.due_at) ||
            matter.priority === "urgent" ||
            matter.priority === "high" ||
            (matter.open_task_count > 0 && matter.progress_percent < 35)),
      )
      .slice(0, 6);
  }, [matters]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createMatter({
      title: title.trim(),
      matterType,
      priority,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      description: null,
    }).then((created) => {
      if (created) {
        setTitle("");
        setDueAt("");
      }
    });
  };

  const createPreset = (preset: (typeof matterPresets)[number]) => {
    createMatter({
      title: preset.title,
      matterType: preset.type,
      priority: preset.priority,
      dueAt: null,
      description: preset.description,
    });
  };

  const createMatter = async ({
    title,
    matterType,
    priority,
    dueAt,
    description,
  }: {
    title: string;
    matterType: MatterType;
    priority: MatterPriority;
    dueAt: string | null;
    description: string | null;
  }) => {
    if (!title) return null;
    setCreating(true);
    try {
      const matter = await governanceApi.createMatter({
        title,
        matter_type: matterType,
        description,
        org_id: null,
        owner_user_id: null,
        starts_at: null,
        due_at: dueAt,
        priority,
        visibility: "internal",
        status: "active",
        meta: {},
      });
      toast.success("已建立事情");
      const item = matterToListItem(matter);
      setMatters((prev) => [item, ...prev]);
      setData((prev) =>
        prev
          ? {
              ...prev,
              matters: [item, ...prev.matters],
              stats: { ...prev.stats, active_matters: prev.stats.active_matters + 1 },
            }
          : prev,
      );
      return matter;
    } catch (error) {
      toast.error("建立事情失敗");
      console.error(error);
      return null;
    } finally {
      setCreating(false);
    }
  };

  const stats = data?.stats;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section
        className="overflow-hidden rounded-lg"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="grid gap-0 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="p-5 lg:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div
                  className="mb-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium"
                  style={{
                    background: "var(--primary-dim)",
                    color: "var(--primary)",
                    border: "1px solid var(--info-border)",
                  }}
                >
                  <Workflow size={13} aria-hidden={true} />
                  Governance Hub 2.0
                </div>
                <h1 className="text-2xl font-semibold tracking-normal" style={{ color: "var(--text-primary)" }}>
                  治理中樞
                </h1>
                <p className="mt-2 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
                  以「事情」為入口，把案件、決議、企劃書、任務、關聯資源與時間軸收進同一個行政脈絡。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href="#quick-create" className="btn btn-primary">
                  <Plus size={14} aria-hidden={true} />
                  建立事情
                </a>
                <a href="#matter-table" className="btn btn-secondary">
                  <LayoutList size={14} aria-hidden={true} />
                  查看列表
                </a>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={BriefcaseBusiness} label="進行中事情" value={stats?.active_matters ?? 0} />
              <Metric icon={AlertTriangle} label="逾期事情" value={stats?.overdue_matters ?? 0} tone="danger" />
              <Metric icon={FolderKanban} label="開放案件" value={stats?.open_cases ?? 0} tone="info" />
              <Metric icon={Clock} label="開放任務" value={stats?.open_tasks ?? 0} tone="warning" />
            </div>
          </div>

          <div className="p-5 lg:p-6" style={{ background: "var(--bg-hover)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  今日行政焦點
                </h2>
                <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                  優先處理逾期、高優先與進度偏低的事情
                </p>
              </div>
              <AlertTriangle size={17} aria-hidden={true} style={{ color: "var(--warning)" }} />
            </div>
            <div className="mt-4 space-y-2">
              {atRiskMatters.map((matter) => (
                <FocusLink key={matter.id} matter={matter} />
              ))}
              {!loading && atRiskMatters.length === 0 && (
                <div
                  className="rounded-md px-3 py-6 text-center text-xs"
                  style={{
                    background: "var(--bg-surface)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  目前沒有高風險事情
                </div>
              )}
              {loading && <LoadingBlock label="整理焦點事項中" />}
            </div>
          </div>
        </div>
      </section>

      <section id="quick-create" className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          aria-label="建立事情"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                快速建立
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                先建立 Matter，後續再補案件、流程、決議與關聯資料。
              </p>
            </div>
            <FilePlus2 size={18} aria-hidden={true} style={{ color: "var(--primary)" }} />
          </div>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                事情名稱
              </span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="input w-full"
                placeholder="例如：2026 校慶園遊會"
                required
              />
            </label>
            <FieldSelect label="類型" value={matterType} onChange={(value) => setMatterType(value as MatterType)}>
              {typeOptions.map((item) => (
                <option key={item} value={item}>
                  {TYPE_LABEL[item]}
                </option>
              ))}
            </FieldSelect>
            <FieldSelect label="優先級" value={priority} onChange={(value) => setPriority(value as MatterPriority)}>
              {priorityOptions.map((item) => (
                <option key={item} value={item}>
                  {PRIORITY_LABEL[item]}
                </option>
              ))}
            </FieldSelect>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                預定完成
              </span>
              <input
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="input w-full"
              />
            </label>
            <button type="submit" className="btn btn-primary self-end" disabled={creating}>
              {creating ? (
                <Loader2 size={14} className="animate-spin" aria-hidden={true} />
              ) : (
                <Plus size={14} aria-hidden={true} />
              )}
              建立事情
            </button>
          </form>
        </div>

        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
          aria-label="治理模板"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                常用治理模板
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                先用情境開局，讓幹部不用從空白表單開始。
              </p>
            </div>
            <Zap size={18} aria-hidden={true} style={{ color: "var(--primary)" }} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {matterPresets.map((preset) => (
              <PresetButton key={preset.title} preset={preset} busy={creating} onClick={() => createPreset(preset)} />
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div
          id="matter-table"
          className="overflow-hidden rounded-lg"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <div
            className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                <LayoutList size={17} aria-hidden={true} style={{ color: "var(--primary)" }} />
                事情作戰列表
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                以一列一件事呈現狀態、進度、案件、任務與期限。
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                load();
              }}
              className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
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
                <Filter size={13} aria-hidden={true} />
                篩選
              </button>
            </form>
          </div>

          {loading ? (
            <LoadingBlock label="載入治理資料中" />
          ) : matters.length === 0 ? (
            <div className="p-10 text-center">
              <FolderKanban
                size={34}
                className="mx-auto"
                aria-hidden={true}
                style={{ color: "var(--text-disabled)" }}
              />
              <p className="mt-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                目前沒有事情
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                從上方建立第一件事情，案件、任務與關聯都會集中到同一頁。
              </p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {matters.map((matter) => (
                <MatterRow key={matter.id} matter={matter} />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <SidePanel icon={CheckCircle2} title="狀態分布">
            <div className="space-y-2">
              {["active", "paused", "completed", "archived"].map((item) => (
                <div key={item} className="flex items-center justify-between gap-3 text-sm">
                  <span style={{ color: "var(--text-muted)" }}>{STATUS_LABEL[item]}</span>
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {statusCounts[item] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </SidePanel>

          <SidePanel icon={GitBranch} title="治理鏈路">
            <div className="space-y-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {["Matter 事情", "Case 案件", "Workflow 流程", "Decision 決議", "Task 任務", "Timeline 歷程"].map(
                (step, index) => (
                  <div key={step} className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-semibold"
                      style={{
                        background: "var(--primary-dim)",
                        color: "var(--primary)",
                        border: "1px solid var(--info-border)",
                      }}
                    >
                      {index + 1}
                    </span>
                    {step}
                  </div>
                ),
              )}
            </div>
          </SidePanel>

          <SidePanel icon={CalendarClock} title="時間敏感">
            <div className="space-y-2">
              {matters
                .filter((matter) => matter.due_at)
                .slice(0, 5)
                .map((matter) => (
                  <Link
                    key={matter.id}
                    href={`/governance/${matter.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs"
                    style={{
                      background: "var(--bg-hover)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                      textDecoration: "none",
                    }}
                  >
                    <span className="truncate">{matter.title}</span>
                    <span style={{ color: isPast(matter.due_at) ? "var(--danger)" : "var(--text-muted)" }}>
                      {formatDate(matter.due_at)}
                    </span>
                  </Link>
                ))}
              {!loading && matters.filter((matter) => matter.due_at).length === 0 && (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  尚無設定期限的事情。
                </p>
              )}
            </div>
          </SidePanel>
        </aside>
      </section>
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
  icon: ComponentType<IconProps>;
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
    <div className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        <Icon size={15} aria-hidden={true} style={{ color }} />
      </div>
      <p className="mt-3 text-2xl font-semibold leading-none" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="input w-full">
        {children}
      </select>
    </label>
  );
}

function PresetButton({
  preset,
  busy,
  onClick,
}: {
  preset: (typeof matterPresets)[number];
  busy: boolean;
  onClick: () => void;
}) {
  const Icon = preset.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="group rounded-md p-3 text-left transition-colors"
      style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
          style={{
            background: "var(--primary-dim)",
            color: "var(--primary)",
            border: "1px solid var(--info-border)",
          }}
        >
          <Icon size={16} aria-hidden={true} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {preset.title}
          </span>
          <span className="mt-1 block text-xs leading-5" style={{ color: "var(--text-muted)" }}>
            {preset.description}
          </span>
        </span>
      </div>
    </button>
  );
}

function FocusLink({ matter }: { matter: MatterListItem }) {
  const danger = isPast(matter.due_at) || matter.priority === "urgent";
  return (
    <Link
      href={`/governance/${matter.id}`}
      className="flex items-center justify-between gap-3 rounded-md px-3 py-2 transition-colors"
      style={{
        background: "var(--bg-surface)",
        border: `1px solid ${danger ? "var(--danger-border)" : "var(--border)"}`,
        textDecoration: "none",
      }}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {matter.title}
        </span>
        <span className="mt-0.5 block truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {PRIORITY_LABEL[matter.priority]} · {matter.open_task_count} 任務 · {formatDate(matter.due_at)}
        </span>
      </span>
      <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
    </Link>
  );
}

function MatterRow({ matter }: { matter: MatterListItem }) {
  return (
    <Link
      href={`/governance/${matter.id}`}
      className="grid gap-3 p-4 transition-colors lg:grid-cols-[minmax(0,1.5fr)_120px_150px_120px_120px_28px] lg:items-center"
      style={{ textDecoration: "none" }}
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge label={TYPE_LABEL[matter.matter_type] ?? matter.matter_type} color="var(--primary)" />
          <Badge label={PRIORITY_LABEL[matter.priority] ?? matter.priority} color={priorityTone(matter.priority)} />
          {isPast(matter.due_at) && <Badge label="逾期" color="var(--danger)" />}
        </div>
        <h3 className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {matter.title}
        </h3>
        {matter.description && (
          <p className="mt-1 line-clamp-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {matter.description}
          </p>
        )}
      </div>
      <div className="text-xs">
        <span
          className="rounded px-2 py-1 font-medium"
          style={{ background: "var(--bg-hover)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
        >
          {STATUS_LABEL[matter.status] ?? matter.status}
        </span>
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span>進度</span>
          <span>{matter.progress_percent}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: "var(--bg-hover)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${matter.progress_percent}%`, background: progressTone(matter.progress_percent) }}
          />
        </div>
      </div>
      <MiniStat label="案件" value={String(matter.case_count)} />
      <MiniStat label="任務/期限" value={`${matter.open_task_count} · ${formatDate(matter.due_at)}`} />
      <ChevronRight size={16} aria-hidden={true} style={{ color: "var(--text-disabled)" }} />
    </Link>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: "var(--bg-hover)", color, border: "1px solid var(--border)" }}
    >
      {label}
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function SidePanel({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<IconProps>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        <Icon size={16} aria-hidden={true} style={{ color: "var(--primary)" }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="p-8 text-center">
      <Loader2 size={18} className="mx-auto animate-spin" aria-hidden={true} style={{ color: "var(--primary)" }} />
      <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  );
}
