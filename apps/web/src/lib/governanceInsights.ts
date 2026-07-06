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
  id?: string;
  label: string;
  href?: string;
  anchor?: string;
  reason: string;
  priority: number;
  quick_action?:
    | "assign-owner"
    | "assign-task-owner"
    | "create-task"
    | "create-case"
    | "link-artifact"
    | "create-resource"
    | "create-note";
  suggested_title?: string;
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
  id: string,
  label: string,
  reason: string,
  priority: number,
  anchor?: string,
  href?: string,
  quickAction?: RecommendedAction["quick_action"],
  suggestedTitle?: string,
) {
  actions.push({
    id,
    label,
    reason,
    priority,
    anchor,
    href,
    quick_action: quickAction,
    suggested_title: suggestedTitle,
  });
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
      pushAction(actions, "matter-overdue-note", "記錄逾期處理", "期限已過，先留下原因與調整後續時程。", 95, "timeline", undefined, "create-note", "逾期原因與調整方案");
    } else if (dueDays === 0) {
      score += 65;
      reasons.push("今天到期");
      badges.push("今天到期");
      pushAction(actions, "matter-due-today-task", "建立今日交付任務", "今天到期，先把最後交付拆成可完成任務。", 88, "tasks", undefined, "create-task", "完成今日交付");
    } else if (dueDays <= 3) {
      score += 35;
      reasons.push(`${dueDays} 天內到期`);
      badges.push("近期到期");
      pushAction(actions, "matter-due-soon-task", "確認近期交付", "期限接近，補上明確任務與負責人。", 70, "tasks", undefined, "create-task", "確認近期交付");
    }
  } else if (active && dueDays === null) {
    score += 16;
    reasons.push("尚未設定期限");
    badges.push("缺期限");
    pushAction(actions, "matter-missing-due", "設定預定完成日", "沒有期限時容易失去追蹤節奏，先補上預定完成時間。", 64, "settings");
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
    pushAction(actions, "matter-no-open-tasks", "建立第一個任務", "進行中的事情需要明確下一步。", 76, "tasks", undefined, "create-task", "確認下一步");
  } else if (openTaskCount >= 6) {
    score += 18;
    reasons.push(`${openTaskCount} 件開放任務`);
    badges.push("任務偏多");
  }

  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "canceled");
  const overdueTasks = openTasks.filter((task) => {
    const days = daysUntil(task.due_at);
    return days !== null && days < 0;
  });
  const unassignedTasks = openTasks.filter((task) => !task.assigned_to_id);
  if (overdueTasks.length > 0) {
    score += 30;
    reasons.push(`${overdueTasks.length} 件任務逾期`);
    badges.push("任務逾期");
    pushAction(actions, "task-overdue", "處理逾期任務", "先更新逾期任務的狀態、期限或負責人。", 84, "tasks");
  }
  if (unassignedTasks.length > 0) {
    score += Math.min(24, 10 + unassignedTasks.length * 4);
    reasons.push(`${unassignedTasks.length} 件任務未指派`);
    badges.push("任務缺人");
    pushAction(
      actions,
      "task-unassigned",
      "補上任務負責人",
      "未指派任務容易卡住，先把責任落到人。",
      73,
      "tasks",
      undefined,
      "assign-task-owner",
    );
  }

  const dueSoonTasks = openTasks.filter((task) => {
    const days = daysUntil(task.due_at);
    return days !== null && days >= 0 && days <= 2;
  });
  const tasksWithoutDue = openTasks.filter((task) => !task.due_at);
  if (dueSoonTasks.length > 0) {
    score += 14;
    badges.push("任務近期到期");
    pushAction(actions, "task-due-soon", "檢查近期任務", "有任務即將到期，先確認交付狀態與支援需求。", 67, "tasks");
  }
  if (tasksWithoutDue.length > 0 && openTasks.length >= 2) {
    score += 12;
    reasons.push(`${tasksWithoutDue.length} 件任務缺期限`);
    pushAction(actions, "task-missing-due", "補上任務期限", "任務沒有期限時難以排序，先補齊重要任務的到期日。", 61, "tasks");
  }

  if (active && linkCount === 0) {
    score += 22;
    reasons.push("尚未連接任何模組資源");
    pushAction(actions, "matter-no-links", "連接跨模組項目", "把公文、會議、公告或問卷納入同一件事情。", 72, "create-artifact", undefined, "link-artifact");
  }

  if (active && caseCount === 0) {
    score += 18;
    reasons.push("尚未拆成案件");
    pushAction(actions, "matter-no-cases", "拆成案件", "用案件看板定義可交付的工作範圍。", 68, "cases", undefined, "create-case", "第一個執行案件");
  }

  if ("owner_user_id" in matter && !matter.owner_user_id && active) {
    score += 26;
    reasons.push("尚未指定負責人");
    badges.push("缺負責人");
    pushAction(actions, "matter-missing-owner", "指派負責人", "讓一位成員接住總體進度與跨模組協調。", 86, "settings", undefined, "assign-owner");
  }

  if ("resources" in matter && matter.resources.length === 0 && active) {
    score += 10;
    reasons.push("尚未加入協作資源");
    pushAction(actions, "matter-no-resources", "加入協作資源", "補上雲端資料夾、會議連結或工作頻道，降低交接成本。", 57, "resources", undefined, "create-resource");
  }

  if ("cases" in matter) {
    const reviewCases = matter.cases.filter((item) => item.status === "review");
    if (reviewCases.length > 0) {
      score += 14;
      badges.push("案件待確認");
      pushAction(actions, "case-review", "確認待審案件", "案件已送到確認欄，適合先判斷通過、退回或補件。", 69, "cases");
    }
    const ownerlessCases = matter.cases.filter((item) => !item.owner_user_id && !["done", "archived", "canceled"].includes(String(item.status)));
    const overdueCases = matter.cases.filter((item) => {
      const days = daysUntil(item.due_at);
      return days !== null && days < 0 && !["done", "archived", "canceled"].includes(String(item.status));
    });
    if (ownerlessCases.length > 0) {
      score += 12;
      reasons.push(`${ownerlessCases.length} 件案件缺負責人`);
      pushAction(actions, "case-missing-owner", "指派案件負責人", "案件需要承辦人，才方便追蹤交付與跨組協作。", 65, "cases");
    }
    if (overdueCases.length > 0) {
      score += 22;
      badges.push("案件逾期");
      pushAction(actions, "case-overdue", "處理逾期案件", "已有案件超過期限，先更新狀態或調整交付安排。", 83, "cases");
    }
  }

  if ("decisions" in matter) {
    const pending = matter.decisions.filter((decision) =>
      ["pending", "in_progress", "partial", "overdue"].includes(String(decision.status)),
    );
    if (pending.length > 0) {
      score += pending.some((decision) => decision.status === "overdue") ? 45 : 24;
      reasons.push(`${pending.length} 筆決議待執行`);
      badges.push("決議待辦");
      pushAction(actions, "decision-pending", "追蹤決議落地", "會議或手動決議需要轉成任務並回報進度。", 82, "decisions");
    }
    const missingDecisionOwners = pending.filter((decision) => !decision.owner_user_id);
    const missingDecisionDue = pending.filter((decision) => !decision.due_at);
    if (missingDecisionOwners.length > 0) {
      score += 14;
      reasons.push(`${missingDecisionOwners.length} 筆決議缺負責人`);
      pushAction(actions, "decision-missing-owner", "指派決議負責人", "決議需要有人承接，才不會只停在紀錄裡。", 71, "decisions");
    }
    if (missingDecisionDue.length > 0) {
      score += 10;
      reasons.push(`${missingDecisionDue.length} 筆決議缺期限`);
      pushAction(actions, "decision-missing-due", "補上決議期限", "補上期限後，後續提醒與逾期判斷才會準確。", 60, "decisions");
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
      pushAction(actions, "plan-review", "處理企劃審查", "企劃書正在審查或需修正。", 62, "plans");
      if (reviewPlans.some((plan) => plan.status === "revision_requested")) {
        score += 16;
        reasons.push("企劃書需修正");
        badges.push("需修正");
        pushAction(actions, "plan-revision-requested", "修正企劃書", "已有企劃被要求修正，先更新版本再送回審查。", 79, "plans");
      }
    } else if (drafts.length > 0 && active) {
      score += 8;
      badges.push("企劃草稿");
      pushAction(actions, "plan-draft", "整理企劃草稿", "企劃仍在草稿狀態，適合補完摘要、附件與送審版本。", 52, "plans");
    }
  }

  if ("role_assignments" in matter && matter.matter_type === "activity" && matter.role_assignments.length === 0) {
    score += 12;
    reasons.push("活動尚未建立人員架構");
    pushAction(actions, "activity-missing-roles", "建立活動職務", "活動型事情需要職務與組別，方便分工和交接。", 56, "roles");
  }

  if ("events" in matter && matter.events.length === 0 && (openTasks.length > 0 || matter.progress_percent > 0)) {
    score += 10;
    reasons.push("尚未留下時間軸紀錄");
    pushAction(actions, "timeline-empty", "補一筆進度紀錄", "任務或進度已有變化，補上時間軸能讓後續交接更清楚。", 54, "timeline", undefined, "create-note", "補充目前進度");
  }

  if (active && openTaskCount > 0 && matter.progress_percent === 0) {
    score += 8;
    reasons.push("已有任務但進度仍為 0%");
    pushAction(actions, "progress-not-started", "更新整體進度", "任務已經展開，建議同步調整事情進度。", 53, "settings");
  }

  if (active && matter.progress_percent === 100) {
    score += 12;
    badges.push("可收尾");
    pushAction(actions, "progress-complete-active", "確認完成並收尾", "進度已到 100%，可確認任務、決議與時間軸後結案。", 74, "timeline");
  }

  if (matter.progress_percent >= 90 && active) {
    pushAction(actions, "progress-nearly-complete", "收尾並歸檔", "進度接近完成，確認決議、附件與時間軸後收尾。", 58, "timeline");
  }

  if (actions.length === 0) {
    pushAction(actions, "stable-review", "查看事情脈絡", "狀態穩定，定期檢查任務、關聯與時間軸即可。", 10);
  }

  actions.sort((a, b) => b.priority - a.priority);
  const risk = riskFromScore(score);

  return {
    risk_level: risk,
    risk_label: RISK_LABEL[risk],
    score: score + RISK_WEIGHT[risk],
    recommended_action: actions[0],
    next_steps: actions.slice(0, 8),
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
