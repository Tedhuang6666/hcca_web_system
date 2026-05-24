"use client";
import StatusTimeline, { type TimelineStep, type TimelineNodeState } from "@/components/ui/StatusTimeline";

type WorkflowStatus =
  | "draft"
  | "under_review"
  | "scheduled"
  | "council_approved"
  | "published"
  | "rejected"
  | "archived";

interface RegulationSnapshot {
  workflow_status: WorkflowStatus;
  /** 由 RegulationWorkflowLog 攤平的時間點，可選。 */
  reviewed_at?: string | null;
  scheduled_at?: string | null;
  approved_at?: string | null;
  published_at?: string | null;
  rejected_at?: string | null;
}

interface RegulationTimelineProps {
  regulation: RegulationSnapshot;
}

const ORDER: WorkflowStatus[] = [
  "draft",
  "under_review",
  "scheduled",
  "council_approved",
  "published",
];

const LABEL: Record<WorkflowStatus, string> = {
  draft: "草稿",
  under_review: "送審中",
  scheduled: "排入議程",
  council_approved: "議會核定",
  published: "已公布",
  rejected: "已退回",
  archived: "已歸檔",
};

/**
 * 法規從草案到公布的端到端時間軸。
 * 處理退回 / 歸檔等分支狀態。
 */
export default function RegulationTimeline({ regulation }: RegulationTimelineProps) {
  const { workflow_status: status } = regulation;

  // 退回或歸檔屬於異常分支，獨立顯示
  if (status === "rejected") {
    return (
      <StatusTimeline steps={[
        { key: "draft", label: LABEL.draft, state: "done" },
        { key: "rejected", label: LABEL.rejected, state: "failed", at: regulation.rejected_at },
      ]} />
    );
  }

  if (status === "archived") {
    return (
      <StatusTimeline steps={[
        { key: "published", label: LABEL.published, state: "done", at: regulation.published_at },
        { key: "archived", label: LABEL.archived, state: "done" },
      ]} />
    );
  }

  const currentIdx = ORDER.indexOf(status);
  const steps: TimelineStep[] = ORDER.map((s, i) => {
    let state: TimelineNodeState;
    if (i < currentIdx) state = "done";
    else if (i === currentIdx) state = status === "published" ? "done" : "current";
    else state = "pending";

    const at =
      s === "under_review" ? regulation.reviewed_at :
      s === "scheduled" ? regulation.scheduled_at :
      s === "council_approved" ? regulation.approved_at :
      s === "published" ? regulation.published_at :
      null;

    return { key: s, label: LABEL[s], state, at };
  });

  return <StatusTimeline steps={steps} />;
}
