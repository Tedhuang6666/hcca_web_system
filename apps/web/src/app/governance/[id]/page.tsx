"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  CheckSquare,
  Clock,
  FileText,
  ExternalLink,
  FilePlus2,
  FolderKanban,
  GitBranch,
  Link2,
  Loader2,
  MessageSquarePlus,
  Plus,
  ScrollText,
  UserRoundCog,
  Workflow,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import { governanceApi } from "@/lib/api";
import type {
  EntityRelationOut,
  AutomationRuleOut,
  GovernanceCaseOut,
  GovernanceCaseStatus,
  GovernanceWorkflowTemplateOut,
  MatterOut,
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

const MODULE_LABEL: Record<string, string> = {
  document: "公文",
  announcement: "公告",
  meeting: "會議",
  vote: "投票",
  survey: "問卷",
  event: "活動",
  ticket: "售票",
  regulation: "法規",
  petition: "陳情",
  external: "外部資源",
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
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      governanceApi.getMatter(matterId),
      governanceApi.listTasks(matterId),
      governanceApi.listAutomationRules(matterId),
      governanceApi.listWorkflowTemplates(),
    ])
      .then(([matterRes, taskRes, automationRes, templateRes]) => {
        setMatter(matterRes);
        setTasks(taskRes);
        setAutomationRules(automationRes);
        setTemplates(templateRes);
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
  const linkedModules = useMemo(() => {
    const linked = new Set(matter?.links.map((link) => link.target_type) ?? []);
    return Object.entries(MODULE_LABEL).map(([key, label]) => ({ key, label, linked: linked.has(key) }));
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
        trigger_type: "manual",
        conditions: {},
        actions: [{ type: "create_task", title: "待設定動作" }],
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
        <Link href="/governance" className="btn btn-secondary mt-4">返回治理中樞</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-lg p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Link href="/governance" className="text-xs font-medium" style={{ color: "var(--primary)", textDecoration: "none" }}>
              治理中樞
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
        <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: "var(--bg-hover)" }}>
          <div className="h-full rounded-full" style={{ width: `${matter.progress_percent}%`, background: "var(--primary)" }} />
        </div>
      </header>

      <section className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              <Workflow size={17} aria-hidden={true} style={{ color: "var(--primary)" }} />
              行政生命週期
            </h2>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {matter.progress_percent}% 完成
            </span>
          </div>
          <LifecycleRail matter={matter} openTasks={openTasks.length} automationRules={automationRules.length} />
        </div>

        <div className="rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            <FileText size={17} aria-hidden={true} style={{ color: "var(--primary)" }} />
            模組覆蓋
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {linkedModules.map((module) => (
              <div
                key={module.key}
                className="rounded-md px-3 py-2 text-xs"
                style={{
                  background: module.linked ? "var(--primary-dim)" : "var(--bg-hover)",
                  color: module.linked ? "var(--primary)" : "var(--text-muted)",
                  border: `1px solid ${module.linked ? "var(--info-border)" : "var(--border)"}`,
                }}
              >
                {module.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="事情頁快速導覽">
        {[
          ["#cases", "案件看板"],
          ["#links", "關聯資源"],
          ["#decisions", "決議追蹤"],
          ["#plans", "企劃版本"],
          ["#tasks", "任務"],
          ["#timeline", "時間軸"],
          ["#roles", "組織"],
          ["#automation", "自動化"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="flex-shrink-0 rounded-md px-3 py-2 text-xs font-medium"
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border)",
              textDecoration: "none",
            }}
          >
            {label}
          </a>
        ))}
      </nav>

      <section className="grid gap-3 lg:grid-cols-4" aria-label="快速新增">
        <QuickForm icon={FilePlus2} title="新增案件" onSubmit={addCase}>
          <input value={caseTitle} onChange={(event) => setCaseTitle(event.target.value)} className="input w-full" placeholder="案件標題" />
        </QuickForm>
        <QuickForm icon={CheckSquare} title="新增任務" onSubmit={addTask}>
          <input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className="input w-full" placeholder="任務標題" />
        </QuickForm>
        <QuickForm icon={Link2} title="新增關聯" onSubmit={addLink}>
          <input value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} className="input w-full" placeholder="資源名稱" />
          <input value={linkHref} onChange={(event) => setLinkHref(event.target.value)} className="input w-full" placeholder="連結網址，可留空" />
        </QuickForm>
        <QuickForm icon={MessageSquarePlus} title="新增紀錄" onSubmit={addNote}>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} className="input min-h-[74px] w-full resize-none" placeholder="寫下進度、決議或待確認事項" />
        </QuickForm>
        {saving && <span className="sr-only">儲存中</span>}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Panel id="cases" icon={FolderKanban} title="案件看板">
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
            <div className="grid gap-2 md:grid-cols-2">
              {matter.links.map((link) => <RelationCard key={link.id} link={link} />)}
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
              {matter.decisions.map((decision) => (
                <article key={decision.id} className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{decision.title}</p>
                    <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>{decision.status}</span>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>{decision.content}</p>
                </article>
              ))}
              {matter.decisions.length === 0 && <EmptyInline label="尚無決議" />}
            </div>
          </Panel>

          <Panel id="plans" icon={FilePlus2} title="企劃書與版本">
            <form onSubmit={addPlanningDocument} className="mb-3 grid gap-2 md:grid-cols-[1fr_1.4fr_auto]">
              <input value={planTitle} onChange={(event) => setPlanTitle(event.target.value)} className="input" placeholder="企劃書名稱" />
              <input value={planContent} onChange={(event) => setPlanContent(event.target.value)} className="input" placeholder="草稿內容摘要" />
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增企劃</button>
            </form>
            <div className="space-y-2">
              {matter.planning_documents.map((doc) => (
                <article key={doc.id} className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{doc.title}</p>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>v{doc.current_version}</span>
                  </div>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{doc.status} · {doc.revisions.length} 個版本</p>
                </article>
              ))}
              {matter.planning_documents.length === 0 && <EmptyInline label="尚無企劃書" />}
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel id="tasks" icon={CheckSquare} title="任務">
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

          <Panel id="timeline" icon={Clock} title="行政時間軸">
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
              <button type="submit" className="btn btn-secondary"><Plus size={13} aria-hidden={true} />新增規則</button>
            </form>
            <div className="space-y-2">
              {automationRules.map((rule) => (
                <div key={rule.id} className="rounded-md p-3" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{rule.name}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{rule.trigger_type} · {rule.actions.length} 動作 · {rule.status}</p>
                </div>
              ))}
              {automationRules.length === 0 && <EmptyInline label="尚未建立自動化規則" />}
            </div>
          </Panel>
        </div>
      </section>
    </div>
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

function LifecycleRail({
  matter,
  openTasks,
  automationRules,
}: {
  matter: MatterOut;
  openTasks: number;
  automationRules: number;
}) {
  const steps = [
    { label: "提出", done: true, detail: "Matter 已建立" },
    { label: "拆案", done: matter.cases.length > 0, detail: `${matter.cases.length} 案件` },
    { label: "審議", done: matter.decisions.length > 0 || matter.planning_documents.length > 0, detail: `${matter.decisions.length} 決議` },
    { label: "執行", done: openTasks > 0 || matter.progress_percent > 0, detail: `${openTasks} 開放任務` },
    { label: "整合", done: matter.links.length > 0, detail: `${matter.links.length} 關聯` },
    { label: "自動化", done: automationRules > 0, detail: `${automationRules} 規則` },
    { label: "歸檔", done: matter.status === "completed" || matter.status === "archived", detail: STATUS_LABEL[matter.status] ?? matter.status },
  ];

  return (
    <div className="grid gap-2 md:grid-cols-7">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className="relative rounded-md p-3"
          style={{
            background: step.done ? "var(--primary-dim)" : "var(--bg-hover)",
            border: `1px solid ${step.done ? "var(--info-border)" : "var(--border)"}`,
          }}
        >
          <div
            className="mb-2 flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold"
            style={{
              background: step.done ? "var(--primary)" : "var(--bg-surface)",
              color: step.done ? "white" : "var(--text-muted)",
              border: `1px solid ${step.done ? "var(--primary)" : "var(--border)"}`,
            }}
          >
            {index + 1}
          </div>
          <p className="text-sm font-semibold" style={{ color: step.done ? "var(--primary)" : "var(--text-primary)" }}>
            {step.label}
          </p>
          <p className="mt-1 truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
            {step.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

function QuickForm({
  icon: Icon,
  title,
  children,
  onSubmit,
}: {
  icon: React.ComponentType<{ size: number; "aria-hidden": boolean; style?: CSSProperties }>;
  title: string;
  children: React.ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        <Icon size={15} aria-hidden={true} style={{ color: "var(--primary)" }} />
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
      <button type="submit" className="btn btn-secondary mt-2 w-full">
        <Plus size={13} aria-hidden={true} />
        新增
      </button>
    </form>
  );
}

function Panel({
  id,
  icon: Icon,
  title,
  children,
}: {
  id?: string;
  icon: React.ComponentType<{ size: number; "aria-hidden": boolean; style?: CSSProperties }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        <Icon size={17} aria-hidden={true} style={{ color: "var(--primary)" }} />
        {title}
      </h2>
      {children}
    </section>
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

function RelationCard({ link }: { link: EntityRelationOut }) {
  const content = (
    <div className="rounded-md p-3 transition-colors" style={{ background: "var(--bg-hover)", border: "1px solid var(--border)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>{link.title}</p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{link.target_type} · {link.relation}</p>
        </div>
        {link.href && <ExternalLink size={14} aria-hidden={true} style={{ color: "var(--primary)" }} />}
      </div>
    </div>
  );
  return link.href ? (
    <Link href={link.href} style={{ textDecoration: "none" }}>{content}</Link>
  ) : content;
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
