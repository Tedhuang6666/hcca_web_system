import { get } from "./core";

export type TaskModule =
  | "document" | "meeting" | "regulation" | "petition"
  | "meal" | "shop" | "survey" | "announcement" | "calendar" | "work_item";

export type TaskAction =
  | "approve" | "attend" | "review" | "publish"
  | "reply" | "fill" | "collect" | "pickup" | "sign"
  | "complete" | "prepare" | "manage";

export type TaskSeverity = "info" | "warning" | "critical";

export interface TaskItem {
  id: string;
  module: TaskModule;
  action: TaskAction;
  title: string;
  subtitle: string | null;
  href: string;
  due_at: string | null;
  severity: TaskSeverity;
  created_at: string;
  priority_score: number;
  priority_reasons: string[];
  recommended_action: string | null;
}

export interface TaskInboxResponse {
  items: TaskItem[];
  total: number;
  by_module: Record<string, number>;
}

export interface TaskCountResponse {
  total: number;
  by_module: Record<string, number>;
  urgent_count: number;
}

export const tasksApi = {
  list: () => get<TaskInboxResponse>("/tasks"),
  count: () => get<TaskCountResponse>("/tasks/count"),
};
