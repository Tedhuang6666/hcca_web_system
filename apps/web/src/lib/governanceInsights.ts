import type {
  DecisionOut,
  GovernanceCaseOut,
  MatterListItem,
  MatterOut,
  PlanningDocumentOut,
  WorkItemOut,
} from "@/lib/types";

export type RiskLevel = "ok" | "info" | "warning" | "critical";

export interface RecommendedAction {
  label: string;
  href?: string;
  anchor?: string;
  reason: string;
  priority: number;
}

export interface OperationalInsight {
  risk_level: RiskLevel;
  risk_label: string;
  score: number;
  recommended_action: RecommendedAction;
  next_steps: RecommendedAction[];
  context_badges: string[];
  reasons: string[];
}

export interface GovernanceContextSummary {
  linked_matters: number;
  direct_relations: number;
  risk_level: RiskLevel;
  headline: string;
  detail: string;
}

const RISK_WEIGHT: Record<RiskLevel, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

const RISK_LABEL: Record<RiskLevel, string> = {
  ok: "穩定",
  info: "需追蹤",
  warning: "有風險",
  critical: "優先處理",
};

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return null;
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return Math.round((dueDay - startOfToday()) / 86_400_000);
}

function pushAction(
  actions: RecommendedAction[],
  label: string,
  reason: string,
  priority: number,
  anchor?: string,
  href?: string,
) {
  actions.push({ label, reason, priority, anchor, href });
}

function riskFromScore(score: number): RiskLevel {
  if (score >= 90) return "critical";
  if (score >= 55) return "warning";
  if (score >= 20) return "info";
  return "ok";
}

export function buildMatterInsight(
  matter: MatterListItem | MatterOut,
  tasks: WorkItemOut[] = [],
): OperationalInsight {
  const reasons: string[] = [];
  const badges: string[] = [];
  const actions: RecommendedAction[] = [];
  let score = 0;

  const dueDays = daysUntil(matter.due_at);
  const active = matter.status === "active";
  if (dueDays !== null && active) {
    if (dueDays < 0) {
      score += 80;
      reasons.push(`已逾期 ${Math.abs(dueDays)} 天`);
      badges.push("逾期");
      pushAction(actions, "檢查逾期原因", "期限已過，先更新任務或調整時程。", 95, "tasks");
    } else if (dueDays === 0) {
      score += 65;
      reasons.push("今天到期");
      badges.push("今天到期");
      pushAction(actions, "完成今日交付", "今天到期，先確認未完成項目。", 88, "tasks");
    } else if (dueDays <= 3) {
      score += 35;
      reasons.push(`${dueDays} 天內到期`);
      badges.push("近期到期");
    }
  }

  if (matter.priority === "urgent") {
    score += 35;
    reasons.push("緊急優先級");
    badges.push("緊急");
  } else if (matter.priority === "high") {
    score += 20;
    badges.push("高優先");
  }

  const openTaskCount =
    "open_task_count" in matter ? matter.open_task_count : tasks.filter((task) => task.status !== "done").length;
  const linkCount = "link_count" in matter ? matter.link_count : matter.links.length;
  const caseCount = "case_count" in matter ? matter.case_count : matter.cases.length;

  if (active && openTaskCount === 0) {
    score += 28;
    reasons.push("沒有開放任務");
    pushAction(actions, "建立第一個任務", "進行中的事情需要明確下一步。", 76, "tasks");
  } else if (openTaskCount >= 6) {
    score += 18;
    reasons.push(`${openTaskCount} 件開放任務`);
    badges.push("任務偏多");
  }

  if (active && linkCount === 0) {
    score += 22;
    reasons.push("尚未連接任何模組資源");
    pushAction(actions, "連接跨模組項目", "把公文、會議、公告或問卷納入同一件事情。", 72, "create-artifact");
  }

  if (active && caseCount === 0) {
    score += 18;
    reasons.push("尚未拆成案件");
    pushAction(actions, "拆成案件", "用案件看板定義可交付的工作範圍。", 68, "cases");
  }

  if ("owner_user_id" in matter && !matter.owner_user_id && active) {
    score += 14;
    reasons.push("尚未指定負責人");
    badges.push("缺負責人");
  }

  if ("decisions" in matter) {
    const pending = matter.decisions.filter((decision) =>
      ["pending", "in_progress", "partial", "overdue"].includes(String(decision.status)),
    );
    if (pending.length > 0) {
      score += pending.some((decision) => decision.status === "overdue") ? 45 : 24;
      reasons.push(`${pending.length} 筆決議待執行`);
      badges.push("決議待辦");
      pushAction(actions, "追蹤決議落地", "會議或手動決議需要轉成任務並回報進度。", 82, "decisions");
    }
  }

  if ("planning_documents" in matter) {
    const reviewPlans = matter.planning_documents.filter((plan) =>
      ["submitted", "in_review", "revision_requested"].includes(String(plan.status)),
    );
    const drafts = matter.planning_documents.filter((plan) => plan.status === "draft");
    if (reviewPlans.length > 0) {
      score += 16;
      badges.push("企劃審查");
      pushAction(actions, "處理企劃審查", "企劃書正在審查或需修正。", 62, "plans");
    } else if (drafts.length > 0 && active) {
      score += 8;
      badges.push("企劃草稿");
    }
  }

  if (matter.progress_percent >= 90 && active) {
    pushAction(actions, "收尾並歸檔", "進度接近完成，確認決議、附件與時間軸後收尾。", 58, "timeline");
  }

  if (actions.length === 0) {
    pushAction(actions, "查看事情脈絡", "狀態穩定，定期檢查任務、關聯與時間軸即可。", 10);
  }

  actions.sort((a, b) => b.priority - a.priority);
  const risk = riskFromScore(score);

  return {
    risk_level: risk,
    risk_label: RISK_LABEL[risk],
    score: score + RISK_WEIGHT[risk],
    recommended_action: actions[0],
    next_steps: actions.slice(0, 3),
    context_badges: badges.slice(0, 4),
    reasons: reasons.slice(0, 4),
  };
}

export function sortMattersByInsight<T extends MatterListItem>(matters: T[]) {
  return matters
    .map((matter) => ({ matter, insight: buildMatterInsight(matter) }))
    .sort((a, b) => b.insight.score - a.insight.score || b.matter.updated_at.localeCompare(a.matter.updated_at));
}

export function buildDecisionInsight(decisions: DecisionOut[]) {
  return decisions.filter((decision) =>
    ["pending", "in_progress", "partial", "overdue"].includes(String(decision.status)),
  );
}

export function buildPlanningInsight(plans: PlanningDocumentOut[]) {
  return plans.filter((plan) =>
    ["submitted", "in_review", "revision_requested", "draft"].includes(String(plan.status)),
  );
}

export function buildCaseInsight(cases: GovernanceCaseOut[]) {
  return cases.filter((item) => !["done", "archived", "canceled"].includes(String(item.status)));
}

export function buildGovernanceContextSummary(
  linkedMatters: number,
  directRelations: number,
): GovernanceContextSummary {
  if (linkedMatters === 0 && directRelations === 0) {
    return {
      linked_matters: 0,
      direct_relations: 0,
      risk_level: "info",
      headline: "尚未納入治理",
      detail: "可把這筆資料納入事情，後續任務、決議與時間軸會集中追蹤。",
    };
  }
  return {
    linked_matters: linkedMatters,
    direct_relations: directRelations,
    risk_level: "ok",
    headline: `已連接 ${linkedMatters + directRelations} 個脈絡`,
    detail: `${linkedMatters} 件治理事情，${directRelations} 個跨模組關聯。`,
  };
}

export function riskColor(risk: RiskLevel) {
  if (risk === "critical") return "var(--danger)";
  if (risk === "warning") return "var(--warning)";
  if (risk === "info") return "var(--primary)";
  return "var(--success, var(--primary))";
}
