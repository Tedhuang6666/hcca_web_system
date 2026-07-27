"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type React from "react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronRight,
  FileText,
  Landmark,
  Link2,
  Loader2,
  Megaphone,
  Plus,
  Receipt,
  Search,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";

import { activitiesApi } from "@/lib/api";
import type {
  Activity,
  ActivitySpawnCreate,
  ActivityWorkspaceItem,
  ActivityWorkspaceOut,
} from "@/lib/types";
import GovernanceLinkPanel from "@/components/governance/GovernanceLinkPanel";

type TabKey =
  | "overview"
  | "tasks"
  | "meetings"
  | "notifications"
  | "people"
  | "finance"
  | "documents";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "總覽" },
  { key: "tasks", label: "待辦" },
  { key: "meetings", label: "會議與日曆" },
  { key: "notifications", label: "通知與公告" },
  { key: "people", label: "人員編組" },
  { key: "finance", label: "經費與採購" },
  { key: "documents", label: "文件資料" },
];

const SPAWN_OPTIONS: Array<{ kind: ActivitySpawnCreate["kind"]; label: string }> = [
  { kind: "task", label: "待辦" },
  { kind: "meeting", label: "會議" },
  { kind: "calendar_event", label: "日曆事件" },
  { kind: "announcement", label: "公告" },
  { kind: "document", label: "公文" },
  { kind: "survey", label: "問卷" },
];

const STATUS_LABEL: Record<string, string> = {
  active: "進行中",
  archived: "已歸檔",
  draft: "草稿",
  ended: "已結束",
  open: "待處理",
  done: "完成",
  warning: "需注意",
};

function dateText(value?: string | null) {
  if (!value) return "未設定";
  return new Date(value).toLocaleDateString("zh-TW");
}

function money(value?: number) {
  return `NT$${Math.round(value ?? 0).toLocaleString()}`;
}

export default function ActivityWorkspacePage() {
  const params = useParams<{ id: string }>();
  const activityId = params.id;
  const [activity, setActivity] = useState<Activity | null>(null);
  const [workspace, setWorkspace] = useState<ActivityWorkspaceOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  const [spawnKind, setSpawnKind] = useState<ActivitySpawnCreate["kind"]>("task");
  const [spawnTitle, setSpawnTitle] = useState("");
  const [spawnDate, setSpawnDate] = useState("");
  const [spawnLocation, setSpawnLocation] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [activityData, workspaceData] = await Promise.all([
        activitiesApi.get(activityId),
        activitiesApi.workspace(activityId),
      ]);
      setActivity(activityData);
      setWorkspace(workspaceData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入活動工作區失敗");
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const summary = workspace?.summary ?? {};
  const allLinkedCount = workspace?.sections.reduce((sum, section) => sum + section.count, 0) ?? 0;
  const meetingsAndCalendar = useMemo(
    () => [...(workspace?.meetings ?? []), ...(workspace?.calendar_events ?? [])],
    [workspace],
  );
  const financeItems = useMemo(
    () => [
      ...((workspace?.procurement ?? []) as ActivityWorkspaceItem[]),
      ...((workspace?.sections ?? [])
        .filter((section) => section.key === "receivable")
        .flatMap((section) => section.items ?? [])
        .map((item) => ({
          id: item.target_id as string,
          title: item.title as string,
          href: item.href as string,
          status: item.target_type as string,
          timestamp: item.created_at as string,
          note: item.note as string | null,
          meta: item.meta as Record<string, unknown>,
        }))),
    ],
    [workspace],
  );

  const submitSpawn = async (event: FormEvent) => {
    event.preventDefault();
    if (!spawnTitle.trim()) return;
    setSaving(true);
    try {
      const timestamp = spawnDate ? new Date(spawnDate).toISOString() : null;
      const result = await activitiesApi.spawn(activityId, {
        kind: spawnKind,
        title: spawnTitle.trim(),
        starts_at: spawnKind === "meeting" || spawnKind === "calendar_event" ? timestamp : null,
        due_at: spawnKind === "task" ? timestamp : null,
        location: spawnLocation.trim() || null,
      });
      toast.success(`已建立「${result.title}」`);
      setSpawnTitle("");
      setSpawnDate("");
      setSpawnLocation("");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立項目失敗");
    } finally {
      setSaving(false);
    }
  };

  const acceptSuggestion = async (suggestionId: string) => {
    try {
      await activitiesApi.acceptSuggestion(activityId, suggestionId);
      toast.success("已掛上活動關聯");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "接受推薦失敗");
    }
  };

  if (loading && !workspace) {
    return <main className="p-6">載入活動工作區中...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
      <header
        className="sticky top-0 z-20 -mx-4 border-b px-4 py-3 lg:-mx-6 lg:px-6"
        style={{ background: "var(--bg)", borderColor: "var(--border)" }}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              活動工作區
            </p>
            <h1 className="truncate text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {activity?.name ?? String(summary.title ?? "活動")}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span>{STATUS_LABEL[String(summary.status ?? activity?.status)] ?? activity?.status}</span>
              <span>{dateText(String(summary.starts_at ?? activity?.starts_at ?? ""))}</span>
              <span>至 {dateText(String(summary.ends_at ?? activity?.ends_at ?? ""))}</span>
              {workspace?.matter_id && (
                <Link href={`/governance/${workspace.matter_id}`} className="font-medium" style={{ color: "var(--primary)" }}>
                  對應事情
                </Link>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activity && (
              <GovernanceLinkPanel
                entityType="activity"
                entityId={activity.id}
                title={activity.name}
                href={`/activities/${activity.id}`}
                compact
              />
            )}
            <Link className="btn btn-ghost" href="/governance">
              <Search size={14} aria-hidden={true} />
              工作中心
            </Link>
            <button className="btn btn-primary" form="activity-spawn-form" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" aria-hidden={true} /> : <Plus size={14} aria-hidden={true} />}
              新增項目
            </button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <Metric icon={CheckSquare} label="待辦" value={Number(summary.open_task_count ?? workspace?.tasks?.length ?? 0)} />
        <Metric icon={Landmark} label="會議/日曆" value={meetingsAndCalendar.length} />
        <Metric icon={Bell} label="通知" value={workspace?.notifications?.length ?? 0} />
        <Metric icon={Receipt} label="未收款" value={money(Number(summary.unpaid_amount ?? workspace?.finance?.unpaid_amount ?? 0))} />
        <Metric icon={Link2} label="關聯資料" value={Number(summary.linked_count ?? allLinkedCount)} />
      </section>

      <section
        className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1fr_360px]"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
      >
        <form id="activity-spawn-form" onSubmit={submitSpawn} className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_190px_160px]">
          <select value={spawnKind} onChange={(event) => setSpawnKind(event.target.value as ActivitySpawnCreate["kind"])} className="input">
            {SPAWN_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>{option.label}</option>
            ))}
          </select>
          <input value={spawnTitle} onChange={(event) => setSpawnTitle(event.target.value)} className="input" placeholder="輸入要新增的項目" />
          <input type="datetime-local" value={spawnDate} onChange={(event) => setSpawnDate(event.target.value)} className="input" />
          <input value={spawnLocation} onChange={(event) => setSpawnLocation(event.target.value)} className="input" placeholder="地點" />
        </form>
        <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>
          在這裡建立的項目會直接掛回此活動，不需要再到各模組複製連結。
        </p>
      </section>

      <nav className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className="flex-shrink-0 px-3 py-2 text-sm font-medium"
              style={{
                color: active ? "var(--primary)" : "var(--text-muted)",
                borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {tab === "overview" && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="活動檢查清單" icon={CheckSquare}>
                <Checklist items={workspace?.checklist ?? []} />
              </Panel>
              <Panel title="下一步" icon={ChevronRight}>
                <ItemList items={workspace?.pending_items as ActivityWorkspaceItem[] ?? []} empty="目前沒有待處理項目。" />
              </Panel>
              <Panel title="近期會議與日曆" icon={CalendarDays}>
                <ItemList items={meetingsAndCalendar.slice(0, 6) as ActivityWorkspaceItem[]} empty="尚未安排會議或日曆事件。" />
              </Panel>
              <Panel title="通知與文件" icon={Megaphone}>
                <ItemList items={([...(workspace?.notifications ?? []), ...(workspace?.documents ?? [])] as ActivityWorkspaceItem[]).slice(0, 6)} empty="尚未建立通知或文件。" />
              </Panel>
            </div>
          )}
          {tab === "tasks" && <Panel title="待辦" icon={CheckSquare}><ItemTable items={workspace?.tasks as ActivityWorkspaceItem[] ?? []} empty="尚未建立活動待辦。" /></Panel>}
          {tab === "meetings" && <Panel title="會議與日曆" icon={CalendarDays}><ItemTable items={meetingsAndCalendar as ActivityWorkspaceItem[]} empty="尚未安排會議或日曆事件。" /></Panel>}
          {tab === "notifications" && <Panel title="通知與公告" icon={Megaphone}><ItemTable items={workspace?.notifications as ActivityWorkspaceItem[] ?? []} empty="尚未建立公告、郵件或發布。" /></Panel>}
          {tab === "people" && <Panel title="人員編組" icon={Users}><ItemTable items={workspace?.people as ActivityWorkspaceItem[] ?? []} empty="尚未設定活動人員。" /></Panel>}
          {tab === "finance" && (
            <Panel title="經費與採購" icon={ShoppingCart}>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <Metric icon={Receipt} label="應收" value={money(workspace?.finance?.total_amount as number | undefined)} />
                <Metric icon={Receipt} label="已收" value={money(workspace?.finance?.paid_amount as number | undefined)} />
                <Metric icon={Receipt} label="未收" value={money(workspace?.finance?.unpaid_amount as number | undefined)} />
              </div>
              <ItemTable items={financeItems} empty="尚未建立採購、商品、訂單或收款資料。" />
            </Panel>
          )}
          {tab === "documents" && <Panel title="文件資料" icon={FileText}><ItemTable items={workspace?.documents as ActivityWorkspaceItem[] ?? []} empty="尚未建立公文、問卷或法規資料。" /></Panel>}
        </div>

        <aside className="space-y-4">
          <Panel title="系統推薦關聯" icon={Link2}>
            <div className="space-y-2">
              {(workspace?.suggestions ?? []).length === 0 && (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>目前沒有新的推薦。</p>
              )}
              {(workspace?.suggestions ?? []).map((item) => (
                <div key={item.suggestion_id} className="rounded border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                        {item.target_type} · {item.score} 分
                      </p>
                    </div>
                    <button type="button" className="btn btn-primary text-xs" onClick={() => void acceptSuggestion(item.suggestion_id)}>
                      掛上
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="所有關聯" icon={Link2}>
            <div className="space-y-2">
              {(workspace?.sections ?? []).map((section) => (
                <Link key={section.key} href={`/activities/${activityId}#${section.key}`} className="flex items-center justify-between rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                  <span>{section.title}</span>
                  <span style={{ color: "var(--text-muted)" }}>{section.count}</span>
                </Link>
              ))}
            </div>
          </Panel>
        </aside>
      </section>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <Icon size={14} aria-hidden={true} />
        {label}
      </div>
      <p className="mt-1 truncate text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
      <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <Icon size={15} aria-hidden={true} style={{ color: "var(--primary)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h2>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function Checklist({ items }: { items: Array<{ key: string; title: string; status: string; action: string }> }) {
  if (items.length === 0) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚未產生檢查清單。</p>;
  return (
    <div className="divide-y" style={{ borderColor: "var(--border)" }}>
      {items.map((item) => (
        <div key={item.key} className="grid gap-1 py-2 sm:grid-cols-[1fr_80px]">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{item.action}</p>
          </div>
          <span className="text-xs font-medium" style={{ color: item.status === "done" ? "var(--success)" : "var(--warning)" }}>
            {STATUS_LABEL[item.status] ?? item.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function ItemList({ items, empty }: { items: ActivityWorkspaceItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <Link key={`${item.id ?? item.title}-${index}`} href={String(item.href ?? "#")} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
          <span className="min-w-0 truncate">{item.title}</span>
          <ChevronRight size={14} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
        </Link>
      ))}
    </div>
  );
}

function ItemTable({ items, empty }: { items: ActivityWorkspaceItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm" style={{ color: "var(--text-muted)" }}>{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            <th className="py-2 pr-3 font-medium">項目</th>
            <th className="py-2 pr-3 font-medium">狀態</th>
            <th className="py-2 pr-3 font-medium">時間</th>
            <th className="py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={`${item.id ?? item.title}-${index}`} className="border-b" style={{ borderColor: "var(--border)" }}>
              <td className="max-w-[320px] py-2 pr-3">
                <p className="truncate font-medium">{item.title}</p>
                {item.location && <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>{item.location}</p>}
              </td>
              <td className="py-2 pr-3" style={{ color: "var(--text-muted)" }}>{String(item.status ?? "未設定")}</td>
              <td className="py-2 pr-3" style={{ color: "var(--text-muted)" }}>{dateText(String(item.starts_at ?? item.due_at ?? item.timestamp ?? ""))}</td>
              <td className="py-2 text-right">
                <Link href={String(item.href ?? "#")} className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: "var(--primary)" }}>
                  開啟
                  <ChevronRight size={12} aria-hidden={true} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
