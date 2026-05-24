"use client";
import StatusTimeline, { type TimelineStep, type TimelineNodeState } from "@/components/ui/StatusTimeline";

interface MeetingSnapshot {
  status: "draft" | "active" | "paused" | "closed";
  confirmed_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  notice_document_id?: string | null;
}

interface MeetingTimelineProps {
  meeting: MeetingSnapshot;
  /** 紀錄是否已發布（後端 meeting_minutes_ready）。 */
  minutesReleasedAt?: string | null;
}

/**
 * 會議從草稿到紀錄發布的端到端時間軸。
 * 節點：草稿 → 議程確認 → 進行中 → 已結束 → 紀錄發布
 */
export default function MeetingTimeline({ meeting, minutesReleasedAt }: MeetingTimelineProps) {
  const steps: TimelineStep[] = [];

  // 1. 草稿建立（永遠 done）
  steps.push({
    key: "draft",
    label: "建立草稿",
    state: "done",
  });

  // 2. 議程確認
  const confirmedState: TimelineNodeState = meeting.confirmed_at
    ? "done"
    : meeting.status === "draft" ? "current" : "pending";
  steps.push({
    key: "confirmed",
    label: "議程確認",
    description: meeting.confirmed_at ? undefined : "完成後自動建立開會通知公文並通知出席者",
    at: meeting.confirmed_at,
    state: confirmedState,
  });

  // 3. 會議進行
  const isStarted = ["active", "paused", "closed"].includes(meeting.status);
  const isProgressing = ["active", "paused"].includes(meeting.status);
  steps.push({
    key: "in_progress",
    label: "會議進行",
    at: isStarted ? meeting.starts_at : null,
    state: isProgressing ? "current" : isStarted ? "done" : "pending",
  });

  // 4. 已結束
  steps.push({
    key: "closed",
    label: "會議結束",
    at: meeting.status === "closed" ? meeting.ends_at : null,
    state: meeting.status === "closed" ? "done" : "pending",
  });

  // 5. 紀錄發布
  steps.push({
    key: "minutes",
    label: "紀錄發布",
    at: minutesReleasedAt,
    state: minutesReleasedAt ? "done"
      : meeting.status === "closed" ? "current"
      : "pending",
  });

  return <StatusTimeline steps={steps} />;
}
