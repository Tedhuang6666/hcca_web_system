import { post } from "./core";

// ── 換屆精靈 ────────────────────────────────────────────────────────────
export interface NewAssignmentIn {
  user_id: string;
  position_id: string;
  start_date: string; // ISO date
  end_date?: string | null;
}

export interface DryRunBody {
  new_term_start: string;
  new_assignments: NewAssignmentIn[];
  terminate_active_before: boolean;
}

export interface TerminationOut {
  user_position_id: string;
  user_id: string;
  user_email: string | null;
  position_id: string;
  position_name: string;
  org_name: string;
  current_end_date: string | null;
  new_end_date: string;
}

export interface SeatAssignmentOut {
  user_id: string;
  user_email: string | null;
  position_id: string;
  position_name: string;
  org_name: string;
  start_date: string;
  end_date: string | null;
  warning: string | null;
}

export interface DryRunOut {
  new_term_start: string;
  terminations: TerminationOut[];
  new_assignments: SeatAssignmentOut[];
  warnings: string[];
  summary: Record<string, number>;
}

export interface ExecuteRolloverOut {
  batch_id: string;
  terminated_count: number;
  created_count: number;
  started_at: string;
  finished_at: string;
}

export interface RollbackOut {
  batch_id: string;
  restored_terminations: number;
  deleted_new_assignments: number;
}

export const termRolloverApi = {
  dryRun: (body: DryRunBody) => post<DryRunOut>("/admin/term-rollover/dry-run", body),
  execute: (body: DryRunBody, confirm_phrase: string) =>
    post<ExecuteRolloverOut>("/admin/term-rollover/execute", { ...body, confirm_phrase }),
  rollback: (batch_id: string, confirm_phrase: string) =>
    post<RollbackOut>(
      `/admin/term-rollover/rollback/${encodeURIComponent(batch_id)}`,
      { confirm_phrase },
    ),
};
