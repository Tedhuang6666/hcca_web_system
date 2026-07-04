"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  CheckSquare,
  ChevronDown,
  Clock,
  ExternalLink,
  FilePlus2,
  FolderKanban,
  GitBranch,
  Loader2,
  Pause,
  Play,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  UserRoundCog,
  Workflow,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import GovernanceArtifactDrawer from "@/components/governance/GovernanceArtifactDrawer";
import GovernanceDiscordPanel from "@/components/governance/GovernanceDiscordPanel";
import PlanningDocumentsPanel from "@/components/governance/PlanningDocumentsPanel";
import { governanceApi } from "@/lib/api";
import type {
  EntityRelationOut,
  AutomationMeta,
  AutomationRuleOut,
  GovernanceCaseOut,
  GovernanceCaseStatus,
  GovernanceWorkflowTemplateOut,
  MatterOut,
  MatterSpawnResult,
  TimelineEventOut,
  WorkItemOut,
} from "@/lib/types";

const CASE_COLUMNS: Array<{ key: GovernanceCaseStatus; label: string }> = [
  { key: "todo", label: "待處理" },
  { key: "in_progress", label: "進行中" },
  { key: "review", label: "待確認" },
  { key: "done", label: "已完成" },
];

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  paused: "暫停",
  completed: "完成",
  archived: "歸檔",
  canceled: "取消",
};

const TARGET_LABEL: Record<string, string> = {
  matter: "事情",
  case: "案件",
  document: "公文",
  meeting: "會議",
  meeting_decision: "會議決議",
  announcement: "公告",
  survey: "問卷",
  activity: "活動",
  regulation: "法規",
  petition: "陳情",
  vote: "投票",
  ticket: "售票",
  external: "外部連結",
};

// 決議來源標記：區分「手動新增」「會議決議自動匯入」「自動化規則產生」。
const DECISION_SOURCE_LABEL: Record<string, string> = {
  meeting_decision: "來自會議決議",
};

const DECISION_STATUS_LABEL: Record<string, string> = {
  pending: "待執行",
  in_progress: "執行中",
  partial: "部分完成",
  completed: "完成",
  overdue: "逾期",
  canceled: "取消",
};

const AUTOMATION_STATUS_LABEL: Record<string, string> = {
  active: "啟用中",
  paused: "已暫停",
  archived: "已歸檔",
};

function formatDate(value?: string | null) {
  if (!value) return "未設定";
  const d = new Date(value);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function GovernanceMatterPage() {
  const params = useParams<{ id: string }>();
  const matterId = params.id;
  const [matter, setMatter] = useState<MatterOut | null>(null);
  const [tasks, setTasks] = useState<WorkItemOut[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRuleOut[]>([]);
  const [automationMeta, setAutomationMeta] = useState<AutomationMeta | null>(null);
  const [automationTrigger, setAutomationTrigger] = useState("meeting.decision_created");
  const [templates, setTemplates] = useState<GovernanceWorkflowTemplateOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [caseTitle, setCaseTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkHref, setLinkHref] = useState("");
  const [note, setNote] = useState("");
  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionContent, setDecisionContent] = useState("");
  const [planTitle, setPlanTitle] = useState("");
  const [planContent, setPlanContent] = useState("");
  const [roleName, setRoleName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [automationName, setAutomationName] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [lastSpawn, setLastSpawn] = useState<MatterSpawnResult | null>(null);
  const [artifactDrawer, setArtifactDrawer] = useState<"create" | "link" | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      governanceApi.getMatter(matterId),
      governanceApi.listTasks(matterId),
      governanceApi.listAutomationRules(matterId),
      governanceApi.listWorkflowTemplates(),
      governanceApi.automationMeta().catch(() => null),
    ])
      .then(([matterRes, taskRes, automationRes, templateRes, metaRes]) => {
        setMatter(matterRes);
        setTasks(taskRes);
        setAutomationRules(automationRes);
        setTemplates(templateRes);
        setAutomationMeta(metaRes);
      })
      .catch((error) => {
        toast.error("無法載入事情中心");
        console.error(error);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === "open"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === "done"), [tasks]);
  const linkedActivityId = useMemo(() => {
    if (!matter || matter.matter_type !== "activity") return null;
    const relation = matter.links.find((link) => link.target_type === "activity" && link.target_id);
    return relation?.target_id ?? null;
  }, [matter]);

  const addCase = (event: FormEvent) => {
    event.preventDefault();
    if (!caseTitle.trim()) return;
    setSaving(true);
    governanceApi
      .createCase(matterId, {
        program_id: null,
        title: caseTitle.trim(),
        case_type: "general",
        description: null,
        owner_user_id: null,
        status: "todo",
        current_step: null,
        due_at: null,
        meta: {},
      })
      .then((created) => {
        toast.success("已新增案件");
        setCaseTitle("");
        setMatter((prev) => prev ? { ...prev, cases: [created, ...prev.cases] } : prev);
      })
      .catch((error) => {
        toast.error("新增案件失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addTask = (event: FormEvent) => {
    event.preventDefault();
    if (!taskTitle.trim()) return;
    setSaving(true);
    governanceApi
      .createTask(matterId, {
        title: taskTitle.trim(),
        description: null,
        assigned_to_id: null,
        source_type: "matter",
        source_id: matterId,
        due_at: null,
      })
      .then((created) => {
        toast.success("已新增任務");
        setTaskTitle("");
        setTasks((prev) => [created, ...prev]);
      })
      .catch((error) => {
        toast.error("新增任務失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addLink = (event: FormEvent) => {
    event.preventDefault();
    if (!linkTitle.trim()) return;
    setSaving(true);
    governanceApi
      .createRelation(matterId, {
        case_id: null,
        source_type: "matter",
        source_id: matterId,
        target_type: "external",
        target_id: null,
        relation: "related",
        title: linkTitle.trim(),
        href: linkHref.trim() || null,
        note: null,
        meta: {},
      })
      .then((created) => {
        toast.success("已新增關聯");
        setLinkTitle("");
        setLinkHref("");
        setMatter((prev) => prev ? { ...prev, links: [created, ...prev.links] } : prev);
      })
      .catch((error) => {
        toast.error("新增關聯失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addNote = (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    governanceApi
      .createEvent(matterId, {
        case_id: null,
        event_type: "comment",
        title: "新增紀錄",
        body: note.trim(),
        payload: {},
      })
      .then((created) => {
        toast.success("已新增時間軸紀錄");
        setNote("");
        setMatter((prev) => prev ? { ...prev, events: [created, ...prev.events] } : prev);
      })
      .catch((error) => {
        toast.error("新增紀錄失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addDecision = (event: FormEvent) => {
    event.preventDefault();
    if (!decisionTitle.trim() || !decisionContent.trim()) return;
    setSaving(true);
    governanceApi
      .createDecision(matterId, {
        case_id: null,
        source_type: null,
        source_id: null,
        title: decisionTitle.trim(),
        content: decisionContent.trim(),
        status: "pending",
        owner_user_id: null,
        due_at: null,
        meta: {},
      })
      .then((created) => {
        toast.success("已新增決議");
        setDecisionTitle("");
        setDecisionContent("");
        setMatter((prev) => prev ? { ...prev, decisions: [created, ...prev.decisions] } : prev);
      })
      .catch((error) => {
        toast.error("新增決議失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addPlanningDocument = (event: FormEvent) => {
    event.preventDefault();
    if (!planTitle.trim()) return;
    setSaving(true);
    governanceApi
      .createPlanningDocument(matterId, {
        case_id: null,
        title: planTitle.trim(),
        summary: null,
        status: "draft",
        meta: {},
        version_label: "草稿版",
        content: planContent.trim(),
        change_reason: "建立企劃書",
      })
      .then((created) => {
        toast.success("已新增企劃書");
        setPlanTitle("");
        setPlanContent("");
        setMatter((prev) =>
          prev ? { ...prev, planning_documents: [created, ...prev.planning_documents] } : prev,
        );
      })
      .catch((error) => {
        toast.error("新增企劃書失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addRoleAssignment = (event: FormEvent) => {
    event.preventDefault();
    if (!roleName.trim()) return;
    setSaving(true);
    governanceApi
      .createRoleAssignment(matterId, {
        parent_id: null,
        role_name: roleName.trim(),
        unit_name: unitName.trim() || null,
        user_id: null,
        start_at: null,
        end_at: null,
        note: null,
        sort_order: matter?.role_assignments.length ?? 0,
      })
      .then((created) => {
        toast.success("已新增組織職務");
        setRoleName("");
        setUnitName("");
        setMatter((prev) =>
          prev ? { ...prev, role_assignments: [...prev.role_assignments, created] } : prev,
        );
      })
      .catch((error) => {
        toast.error("新增組織職務失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addAutomationRule = (event: FormEvent) => {
    event.preventDefault();
    if (!automationName.trim()) return;
    setSaving(true);
    governanceApi
      .createAutomationRule({
        name: automationName.trim(),
        description: null,
        trigger_type: automationTrigger,
        conditions: {},
        actions: [{ type: "create_task", title: `處理：${automationName.trim()}` }],
        matter_id: matterId,
        status: "active",
      })
      .then((created) => {
        toast.success("已新增自動化規則");
        setAutomationName("");
        setAutomationRules((prev) => [created, ...prev]);
      })
      .catch((error) => {
        toast.error("新增自動化規則失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const addWorkflowTemplate = (event: FormEvent) => {
    event.preventDefault();
    if (!templateName.trim()) return;
    setSaving(true);
    governanceApi
      .createWorkflowTemplate({
        name: templateName.trim(),
        template_type: "general",
        description: null,
        version: 1,
        steps: [
          { key: "draft", label: "提出草案" },
          { key: "review", label: "審議" },
          { key: "execute", label: "執行" },
          { key: "archive", label: "歸檔" },
        ],
      })
      .then((created) => {
        toast.success("已新增流程模板");
        setTemplateName("");
        setTemplates((prev) => [created, ...prev]);
      })
      .catch((error) => {
        toast.error("新增流程模板失敗");
        console.error(error);
      })
      .finally(() => setSaving(false));
  };

  const toggleRule = (rule: AutomationRuleOut) => {
    const next = rule.status === "active" ? "paused" : "active";
    governanceApi
      .updateAutomationRule(rule.id, { status: next })
      .then((updated) => {
        setAutomationRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        toast.success(next === "active" ? "規則已啟用" : "規則已暫停");
      })
      .catch((error) => {
        toast.error("更新規則狀態失敗");
        console.error(error);
      });
  };

  const unlinkRelation = (relation: EntityRelationOut) => {
    governanceApi
      .deleteRelation(relation.id)
      .then(() => {
        setMatter((prev) =>
          prev ? { ...prev, links: prev.links.filter((l) => l.id !== relation.id) } : prev,
        );
        toast.success("已解除關聯");
      })
      .catch((error) => {
        toast.error("解除關聯失敗");
        console.error(error);
      });
  };

  const updateCaseStatus = (item: GovernanceCaseOut, status: GovernanceCaseStatus) => {
    governanceApi
      .updateCase(item.id, { status })
      .then((updated) => {
        setMatter((prev) =>
          prev
            ? { ...prev, cases: prev.cases.map((row) => row.id === updated.id ? updated : row) }
            : prev,
        );
      })
      .catch((error) => {
        toast.error("更新案件狀態失敗");
        console.error(error);
      });
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl rounded-lg p-10 text-center" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <Loader2 size={20} className="mx-auto animate-spin" aria-hidden={true} style={{ color: "var(--primary)" }} />
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>載入事情中心中</p>
      </div>
    );
  }

  if (!matter) {
    return (
      <div className="mx-auto max-w-3xl rounded-lg p-10 text-center" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>找不到這件事情</p>
        <Link href="/governance" className="btn btn-secondary mt-4">返回工作中心</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-lg p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link href="/governance" className="text-xs font-medium" style={{ color: "var(--primary)", textDecoration: "none" }}>
              工作中心
            </Link>
            <h1 className="mt-2 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>{matter.title}</h1>
            {matter.description && <p className="mt-2 max-w-3xl text-sm" style={{ color: "var(--text-muted)" }}>{matter.description}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[440px]">
            <TopStat label="狀態" value={STATUS_LABEL[matter.status] ?? matter.status} />
            <TopStat label="進度" value={`${matter.progress_percent}%`} />
            <TopStat label="期限" value={formatDate(matter.due_at)} />
            <TopStat label="開放任務" value={String(openTasks.length)} />
          </div>
        </div>
        {linkedActivityId && (
          <div className="mt-4">
            <Link href={`/activities/${linkedActivityId}`} className="btn btn-secondary">
              返回活動工作區
            </Link>
          </div>
        )}
        <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: "var(--bg-hover)" }}>
          <div className="h-full rounded-full" style={{ width: `${matter.progress_percent}%`, background: "var(--primary)" }} />
        </div>
      </header>

      {saving && <span className="sr-only">儲存中</span>}

      <section
        className="rounded-lg p-4"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        aria-label="從事情建立並連動"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={16} aria-hidden={true} style={{ color: "var(--primary)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            下一步：建立執行項目
          </h2>
        </div>
        <div className="mb-4 grid gap-2 md:grid-cols-3">
          <NextStep number="1" title="拆成案件" detail="用下方案件看板整理可交付的工作範圍。" href="#cases" />
          <NextStep number="2" title="建立跨模組項目" detail="在這裡建立後會自動連回本事情。" href="#create-artifact" />
          <NextStep number="3" title="追蹤執行" detail="任務、決議與模組事件會集中回流。" href="#tasks" />
        </div>
        <div id="create-artifact" className="scroll-mt-24 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            className="btn btn-primary min-h-12 justify-center"
            onClick={() => setArtifactDrawer("create")}
          >
            <Plus size={16} aria-hidden={true} />
            建立新項目
          </button>
          <button
            type="button"
            className="btn btn-secondary min-h-12 justify-center"
            onClick={() => setArtifactDrawer("link")}
          >
            <GitBranch size={16} aria-hidden={true} />
            連接既有項目
          </button>
        </div>
        <p className="mt-2 text-[11px]" style={{ color: "var(--text-disabled)" }}>
          建立的項目會自動連動本事情，其後續生命週期（核准／發布／決議…）會自動回流到下方時間軸。
        </p>
        {lastSpawn && (
          <div
            className="mt-3 flex flex-col gap-2 rounded-md p-3 sm:flex-row sm:items-center sm:justify-between"
            style={{ background: "var(--success-dim)", border: "1px solid var(--border)" }}
            role="status"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: "var(--success)" }}>
                已建立並連動
              </p>
              <p className="mt-0.5 truncate text-sm" style={{ color: "var(--text-primary)" }}>
                {lastSpawn.title}
              </p>
            </div>
            <Link href={lastSpawn.href} className="btn btn-primary flex-shrink-0">
              立即前往
              <ExternalLink size={13} aria-hidden={true} />
            </Link>
          </div>
        )}
      </section>

      <GovernanceDiscordPanel matterId={matterId} initial={matter.discord_workspace} />

      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Panel id="cases" icon={FolderKanban} title="案件看板" defaultOpen>
            <form onSubmit={addCase} className="mb-3 flex gap-2">
              <input value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} className="input min-w-0 flex-1" placeholder="新增案件" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增</button>
            </form>
            <div className="grid gap-3 md:grid-cols-4">
              {CASE_COLUMNS.map((column) => {
                const rows = matter.cases.filter((item) => item.status === column.key);
                return (
                  <div key={column.key} className="rounded-lg p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{column.label}</h3>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{rows.length}</span>
                    </div>
                    <div className="space-y-2">
                      {rows.map((item) => (
                        <CaseCard key={item.id} item={item} onStatus={updateCaseStatus} />
                      ))}
                      {rows.length === 0 && <p className="py-5 text-center text-xs" style={{ color: "var(--text-muted)" }}>暫無案件</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel id="links" icon={GitBranch} title="關聯資源">
            <form onSubmit={addLink} className="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} className="input" placeholder="資源名稱" />
              <input value={linkHref} onChange={(event) => setLinkHref(event.target.value)} className="input" placeholder="連結網址，可留空" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增</button>
            </form>
            <div className="grid gap-2 md:grid-cols-2">
              {matter.links.map((link) => (
                <RelationCard key={link.id} link={link} onUnlink={unlinkRelation} />
              ))}
              {matter.links.length === 0 && <EmptyInline label="尚未建立關聯資源" />}
            </div>
          </Panel>

          <Panel id="decisions" icon={ScrollText} title="決議追蹤">
            <form onSubmit={addDecision} className="mb-3 grid gap-2 md:grid-cols-[1fr_1.4fr_auto]">
              <input value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} className="input" placeholder="決議標題" />
              <input value={decisionContent} onChange={(event) => setDecisionContent(event.target.value)} className="input" placeholder="決議內容" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增決議</button>
            </form>
            <div className="grid gap-2 md:grid-cols-2">
              {matter.decisions.map((decision) => {
                const sourceLabel = decision.source_type
                  ? DECISION_SOURCE_LABEL[decision.source_type]
                  : null;
                return (
                  <article key={decision.id} className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{decision.title}</p>
                      <span className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                        {DECISION_STATUS_LABEL[decision.status] ?? decision.status}
                      </span>
                    </div>
                    <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{decision.content}</p>
                    {sourceLabel && (
                      <span
                        className="mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
                      >
                        <Zap size={9} aria-hidden={true} />
                        {sourceLabel}
                      </span>
                    )}
                  </article>
                );
              })}
              {matter.decisions.length === 0 && <EmptyInline label="尚無決議" />}
            </div>
          </Panel>

          <Panel id="plans" icon={FilePlus2} title="企劃書與版本">
            <form onSubmit={addPlanningDocument} className="mb-3 grid gap-2 md:grid-cols-[1fr_1.4fr_auto]">
              <input value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} className="input" placeholder="企劃書名稱" />
              <input value={planContent} onChange={(event) => setPlanContent(event.target.value)} className="input" placeholder="草稿內容摘要" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增企劃</button>
            </form>
            <PlanningDocumentsPanel
              documents={matter.planning_documents}
              onChange={(planningDocuments) =>
                setMatter((current) =>
                  current ? { ...current, planning_documents: planningDocuments } : current,
                )
              }
            />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel id="tasks" icon={CheckSquare} title="任務" defaultOpen>
            <form onSubmit={addTask} className="mb-3 flex gap-2">
              <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className="input min-w-0 flex-1" placeholder="新增任務" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增</button>
            </form>
            <div className="space-y-2">
              {openTasks.map((task) => <TaskRow key={task.id} task={task} />)}
              {openTasks.length === 0 && <EmptyInline label="沒有開放任務" />}
              {completedTasks.length > 0 && (
                <div className="pt-2">
                  <p className="mb-2 text-xs font-medium" style={{ color: "var(--text-muted)" }}>已完成</p>
                  {completedTasks.slice(0, 5).map((task) => <TaskRow key={task.id} task={task} muted />)}
                </div>
              )}
            </div>
          </Panel>

          <Panel id="timeline" icon={Clock} title="行政時間軸" defaultOpen>
            <form onSubmit={addNote} className="mb-3 flex gap-2">
              <input value={note} onChange={(event) => setNote(event.target.value)} className="input min-w-0 flex-1" placeholder="新增進度紀錄" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增</button>
            </form>
            <div className="space-y-3">
              {[...matter.events]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((event) => <TimelineRow key={event.id} event={event} />)}
              {matter.events.length === 0 && <EmptyInline label="尚無時間軸紀錄" />}
            </div>
          </Panel>

          <Panel id="roles" icon={UserRoundCog} title="人員與組織架構">
            <form onSubmit={addRoleAssignment} className="mb-3 grid gap-2">
              <input value={roleName} onChange={(event) => setRoleName(event.target.value)} className="input" placeholder="職務，例如：總召、場務組長" />
              <input value={unitName} onChange={(event) => setUnitName(event.target.value)} className="input" placeholder="組別，可留空" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增職務</button>
            </form>
            <div className="space-y-2">
              {[...matter.role_assignments]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((role) => (
                  <div key={role.id} className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{role.role_name}</p>
                    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{role.unit_name || "未分組"} · {role.user_id || "尚未指派"}</p>
                  </div>
                ))}
              {matter.role_assignments.length === 0 && <EmptyInline label="尚未建立組織職務" />}
            </div>
          </Panel>

          <Panel id="workflow" icon={Workflow} title="流程模板">
            <form onSubmit={addWorkflowTemplate} className="mb-3 grid gap-2">
              <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} className="input" placeholder="模板名稱，例如：活動流程" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增模板</button>
            </form>
            <div className="space-y-2">
              {templates.slice(0, 5).map((template) => (
                <div key={template.id} className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{template.name}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{template.template_type} · {template.steps.length} 步驟</p>
                </div>
              ))}
              {templates.length === 0 && <EmptyInline label="尚未建立流程模板" />}
            </div>
          </Panel>

          <Panel id="automation" icon={Zap} title="自動化規則">
            <form onSubmit={addAutomationRule} className="mb-3 grid gap-2">
              <input value={automationName} onChange={(event) => setAutomationName(event.target.value)} className="input" placeholder="規則名稱，例如：活動結束後建立問卷" />
              <label className="space-y-1">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>觸發時機</span>
                <select
                  value={automationTrigger}
                  onChange={(event) => setAutomationTrigger(event.target.value)}
                  className="input w-full"
                >
                  {Object.entries(automationMeta?.trigger_types ?? { "meeting.decision_created": "會議產生決議" }).map(
                    ([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ),
                  )}
                </select>
              </label>
              <p className="text-[11px]" style={{ color: "var(--text-disabled)" }}>
                新規則預設動作為「建立任務」並立即啟用；可於後端調整動作內容。
              </p>
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增規則</button>
            </form>
            <div className="space-y-2">
              {automationRules.map((rule) => (
                <AutomationRuleRow
                  key={rule.id}
                  rule={rule}
                  meta={automationMeta}
                  scoped={rule.matter_id === matterId}
                  onToggle={toggleRule}
                />
              ))}
              {automationRules.length === 0 && <EmptyInline label="尚未建立自動化規則" />}
            </div>
          </Panel>
        </div>
      </section>
      <GovernanceArtifactDrawer
        open={artifactDrawer !== null}
        mode={artifactDrawer ?? "create"}
        matter={matter}
        onClose={() => setArtifactDrawer(null)}
        onLinked={(relation) =>
          setMatter((current) =>
            current ? { ...current, links: [relation, ...current.links] } : current,
          )
        }
        onSpawned={(result) => {
          setLastSpawn(result);
          load();
        }}
      />
    </div>
  );
}

function NextStep({
  number,
  title,
  detail,
  href,
}: {
  number: string;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex gap-3 rounded-md p-3 transition-colors hover:bg-[var(--bg-hover)]"
      style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", textDecoration: "none" }}
    >
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
      >
        {number}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        <span className="mt-0.5 block text-xs" style={{ color: "var(--text-muted)" }}>
          {detail}
        </span>
      </span>
    </Link>
  );
}

function TopStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
      <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className="mt-1 truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}

function Panel({
  id,
  icon: Icon,
  title,
  children,
  defaultOpen = false,
}: {
  id?: string;
  icon: React.ComponentType<{ size: number; "aria-hidden": boolean; style?: CSSProperties }>;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="group scroll-mt-24 overflow-hidden rounded-lg"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        <Icon size={16} aria-hidden={true} style={{ color: "var(--primary)" }} />
        {title}
        <ChevronDown
          size={14}
          className="ml-auto transition-transform group-open:rotate-180"
          aria-hidden={true}
          style={{ color: "var(--text-muted)" }}
        />
      </summary>
      <div className="px-4 pb-4 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
        {children}
      </div>
    </details>
  );
}

function CaseCard({
  item,
  onStatus,
}: {
  item: GovernanceCaseOut;
  onStatus: (item: GovernanceCaseOut, status: GovernanceCaseStatus) => void;
}) {
  return (
    <article className="rounded-md p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{item.title}</p>
      {item.current_step && <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{item.current_step}</p>}
      <select
        value={item.status}
        onChange={(event) => onStatus(item, event.target.value as GovernanceCaseStatus)}
        className="input mt-3 w-full text-xs"
      >
        {CASE_COLUMNS.map((column) => (
          <option key={column.key} value={column.key}>{column.label}</option>
        ))}
      </select>
    </article>
  );
}

function RelationCard({
  link,
  onUnlink,
}: {
  link: EntityRelationOut;
  onUnlink: (link: EntityRelationOut) => void;
}) {
  const targetLabel = TARGET_LABEL[link.target_type] ?? link.target_type;
  const inner = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{link.title}</p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {targetLabel}
          {link.href ? " · 可前往" : ""}
        </p>
      </div>
      {link.href && <ExternalLink size={14} aria-hidden={true} style={{ color: "var(--primary)" }} />}
    </>
  );
  return (
    <div
      className="flex items-center gap-2 rounded-md p-3 transition-colors"
      style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}
    >
      {link.href ? (
        <Link href={link.href} className="flex min-w-0 flex-1 items-start justify-between gap-2" style={{ textDecoration: "none" }}>
          {inner}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2">{inner}</div>
      )}
      <button
        type="button"
        onClick={() => onUnlink(link)}
        className="topbar-icon-btn flex-shrink-0"
        aria-label={`解除關聯：${link.title}`}
        title="解除關聯"
      >
        <Trash2 size={13} aria-hidden={true} style={{ color: "var(--text-muted)" }} />
      </button>
    </div>
  );
}

function AutomationRuleRow({
  rule,
  meta,
  scoped,
  onToggle,
}: {
  rule: AutomationRuleOut;
  meta: AutomationMeta | null;
  scoped: boolean;
  onToggle: (rule: AutomationRuleOut) => void;
}) {
  const triggerLabel = meta?.trigger_types?.[rule.trigger_type] ?? rule.trigger_type;
  const active = rule.status === "active";
  return (
    <div className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{rule.name}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            觸發：{triggerLabel} · {rule.actions.length} 個動作{scoped ? "" : " · 全域"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(rule)}
          className="flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium"
          style={{
            background: active ? "var(--success-dim, var(--primary-dim))" : "var(--bg-surface)",
            color: active ? "var(--success, var(--primary))" : "var(--text-muted)",
            border: "1px solid var(--border)",
          }}
          aria-label={active ? "暫停規則" : "啟用規則"}
        >
          {active ? <Pause size={11} aria-hidden={true} /> : <Play size={11} aria-hidden={true} />}
          {AUTOMATION_STATUS_LABEL[rule.status] ?? rule.status}
        </button>
      </div>
      <p className="mt-2 text-[10px]" style={{ color: "var(--text-disabled)" }}>
        已觸發 {rule.trigger_count} 次
        {rule.last_triggered_at ? ` · 最近 ${formatDate(rule.last_triggered_at)}` : " · 尚未觸發"}
      </p>
    </div>
  );
}

function TaskRow({ task, muted = false }: { task: WorkItemOut; muted?: boolean }) {
  return (
    <div className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)", opacity: muted ? 0.72 : 1 }}>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{task.title}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>{task.status === "done" ? "已完成" : "開放"}</span>
        <span>{formatDate(task.due_at)}</span>
      </div>
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineEventOut }) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: "var(--primary)" }}>
      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{event.title}</p>
      {event.body && <p className="mt-1 whitespace-pre-wrap text-xs" style={{ color: "var(--text-muted)" }}>{event.body}</p>}
      <p className="mt-1 text-[10px]" style={{ color: "var(--text-disabled)" }}>
        {formatDate(event.created_at)}{event.actor_email ? ` · ${event.actor_email}` : ""}
      </p>
    </div>
  );
}

function EmptyInline({ label }: { label: string }) {
  return (
    <div className="rounded-md p-5 text-center text-xs" style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
      {label}
    </div>
  );
}
