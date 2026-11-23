"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, GraduationCap, Plus, RefreshCcw, ShieldOff, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { useConfirm, usePrompt } from "@/components/ui/ConfirmDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { adminApi, apiErrorMessage, userLifecycleApi, usersApi } from "@/lib/api";
import { today } from "@/lib/dateUtils";
import type { AdminUserDetail, PositionSummary, UserPositionRead } from "@/lib/types";

type LifecycleAction = "freeze" | "archive_alumni" | "restore";

const ACTION_LABEL: Record<LifecycleAction, string> = {
  freeze: "凍結帳號（停所有任期）",
  archive_alumni: "校友歸檔",
  restore: "解凍 / 恢復",
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-[var(--border)] p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {description && <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "danger";
}) {
  const toneClass = tone === "primary"
    ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)]"
    : tone === "danger"
      ? "border-[var(--danger-border)] text-[var(--danger)]"
      : "border-[var(--border)] text-[var(--text-secondary)]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto ${toneClass}`}
    >
      {children}
    </button>
  );
}

function DateInput({
  value,
  onChange,
  label,
  min,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
}) {
  return (
    <label className="block min-w-0 text-xs text-[var(--text-muted)]">
      {label}
      <input
        type="date"
        value={value}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        className="input scheme-dark mt-1 min-h-11 w-full"
      />
    </label>
  );
}

export function AccountLifecycleSection({
  user,
  onChanged,
}: {
  user: AdminUserDetail;
  onChanged: () => Promise<void>;
}) {
  const { can, isAdmin } = usePermissions();
  const canManageLifecycle = isAdmin || can("system:user_lifecycle");
  const prompt = usePrompt();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof userLifecycleApi.status>> | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setStatus(await userLifecycleApi.status(user.id));
    } catch {
      setStatus(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    if (canManageLifecycle) void loadStatus();
    else setLoading(false);
  }, [canManageLifecycle, loadStatus]);

  const runAction = async (action: LifecycleAction) => {
    if (!status) return;
    const confirmInput = await prompt({
      title: `執行「${ACTION_LABEL[action]}」？`,
      description: `目標為 ${status.email}，目前有 ${status.active_positions.length} 個有效任期。${action === "restore" ? "" : "此動作會結束所有有效任期。"}`,
      inputLabel: "請輸入「確認」以繼續",
      required: true,
      confirmLabel: "執行操作",
      danger: action !== "restore",
    });
    if (confirmInput?.trim() !== "確認") {
      if (confirmInput !== null) toast.info("輸入文字不符，未執行操作");
      return;
    }

    setBusy(true);
    try {
      const operation = {
        freeze: userLifecycleApi.freeze,
        archive_alumni: userLifecycleApi.archiveAlumni,
        restore: userLifecycleApi.restore,
      }[action];
      const result = await operation(user.id, reason);
      toast.success(`完成 ${ACTION_LABEL[action]}：影響 ${result.affected_positions} 個任期`);
      await Promise.all([loadStatus(), onChanged()]);
    } catch (error) {
      toast.error(apiErrorMessage(error, "操作失敗"));
    } finally {
      setBusy(false);
    }
  };

  if (!canManageLifecycle) {
    return (
      <Section title="帳號停權與學籍">
        <p className="text-sm text-[var(--text-muted)]">需要學籍異動權限才能查看或變更帳號狀態。</p>
      </Section>
    );
  }

  return (
    <Section
      title="帳號停權與學籍"
      description="凍結、校友歸檔或解凍此帳號。操作會結束有效任期並保留稽核紀錄；解凍不會重建已結束的任期。"
    >
      <label className="block text-xs text-[var(--text-muted)]">
        原因（會寫入 audit log）
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="例如：畢業、退學、轉出或申請凍結"
          className="input mt-1 min-h-11 w-full"
        />
      </label>

      {loading ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]" role="status">載入帳號狀態…</p>
      ) : loadError ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--danger-dim)] p-3" role="alert">
          <p className="text-sm text-[var(--danger)]">無法載入帳號學籍狀態。</p>
          <ActionButton onClick={() => void loadStatus()} disabled={busy}><RefreshCcw size={15} />重新讀取</ActionButton>
        </div>
      ) : status ? (
        <>
          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{status.display_name}</p>
              <p className="break-all text-xs text-[var(--text-muted)]">{status.email}</p>
            </div>
            <span
              className={`max-w-full break-words rounded-full px-2.5 py-1 text-xs font-medium ${
                status.is_active
                  ? "bg-[var(--success-dim)] text-[var(--success)]"
                  : "bg-[var(--warning-dim)] text-[var(--warning)]"
              }`}
            >
              {status.is_active ? "啟用中" : "已凍結"} · {status.active_positions.length} 個有效任期
            </span>
          </div>

          {status.active_positions.length > 0 ? (
            <details className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2">
              <summary className="min-h-8 cursor-pointer py-1 text-xs text-[var(--text-secondary)]">查看有效任期日期</summary>
              <div className="mt-2 space-y-2">
                {status.active_positions.map((position) => (
                  <div key={position.user_position_id} className="grid grid-cols-1 gap-1 text-xs text-[var(--text-muted)] sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-2">
                    <span className="truncate">{user.positions.find((item) => item.id === position.position_id)?.name ?? `職位 ${position.position_id.slice(0, 8)}`}</span>
                    <span className="break-words sm:text-right">{position.start_date} 至 {position.end_date ?? "無限期"}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <p className="mt-3 text-xs text-[var(--text-muted)]">目前沒有有效任期。</p>
          )}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <ActionButton onClick={() => void runAction("freeze")} disabled={busy || !status.is_active}>
              <ShieldOff size={15} />凍結
            </ActionButton>
            <ActionButton onClick={() => void runAction("archive_alumni")} disabled={busy} tone="danger">
              <GraduationCap size={15} />校友歸檔
            </ActionButton>
            <ActionButton onClick={() => void runAction("restore")} disabled={busy || status.is_active} tone="primary">
              <UserCheck size={15} />解凍 / 恢復
            </ActionButton>
            <ActionButton onClick={() => void loadStatus()} disabled={busy}>
              <RefreshCcw size={15} />重新讀取
            </ActionButton>
          </div>
        </>
      ) : null}

      <div className="mt-3 flex min-w-0 items-start gap-2 rounded-lg bg-[var(--warning-dim)] px-3 py-2.5 text-xs text-[var(--warning)]">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
        <p>解凍只恢復帳號啟用狀態，不會重建已結束任期；需要時請在下方任期管理重新指派。</p>
      </div>
    </Section>
  );
}

function PositionTenureRow({
  user,
  position,
  busy,
  onSave,
  onRemove,
}: {
  user: AdminUserDetail;
  position: UserPositionRead;
  busy: boolean;
  onSave: (startDate: string, endDate: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [startDate, setStartDate] = useState(position.start_date);
  const [endDate, setEndDate] = useState(position.end_date ?? "");

  useEffect(() => {
    setStartDate(position.start_date);
    setEndDate(position.end_date ?? "");
  }, [position]);

  return (
    <article className="min-w-0 rounded-lg border border-[var(--border)] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-words text-sm font-medium text-[var(--text-primary)]">
            {position.position_org_name} · {position.position_name}
          </h4>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {startDate <= today() && (!endDate || endDate >= today()) ? "有效任期" : endDate && endDate < today() ? "已結束" : "尚未開始"}
          </p>
        </div>
        <ActionButton onClick={() => void onRemove()} disabled={busy} tone="danger">移除任期</ActionButton>
      </div>
      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <DateInput value={startDate} onChange={setStartDate} label="開始日期" />
        <DateInput value={endDate} onChange={setEndDate} label="結束日期（空白代表無限期）" min={startDate} />
        <ActionButton onClick={() => void onSave(startDate, endDate)} disabled={busy || !startDate || Boolean(endDate && endDate < startDate)} tone="primary">
          <CalendarDays size={15} />{busy ? "儲存中…" : "儲存日期"}
        </ActionButton>
      </div>
      <span className="sr-only">{user.display_name} 的任期資料</span>
    </article>
  );
}

export function AccountTenureSection({
  user,
  onChanged,
}: {
  user: AdminUserDetail;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirm();
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [assignments, setAssignments] = useState<UserPositionRead[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [positionRows, userPositionRows] = await Promise.all([
        adminApi.listPositions(),
        usersApi.positionsForAdmin(user.id),
      ]);
      setPositions(positionRows);
      setAssignments(userPositionRows);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    await Promise.all([load(), onChanged()]);
  };

  const activePositionIds = new Set(
    assignments
      .filter((assignment) => !assignment.end_date || assignment.end_date >= today())
      .map((assignment) => assignment.position_id),
  );
  const available = positions.filter((position) => position.org_is_active && !activePositionIds.has(position.id));

  const add = async () => {
    if (!selectedPositionId || !startDate) return;
    if (endDate && endDate < startDate) {
      toast.error("任期結束日不能早於開始日");
      return;
    }
    setAdding(true);
    try {
      await adminApi.addUserPosition(user.id, {
        position_id: selectedPositionId,
        start_date: startDate,
        end_date: endDate || null,
      });
      toast.success("幹部任期已新增");
      setSelectedPositionId("");
      setStartDate(today());
      setEndDate("");
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "新增幹部任期失敗"));
    } finally {
      setAdding(false);
    }
  };

  const save = async (position: UserPositionRead, nextStart: string, nextEnd: string) => {
    if (nextEnd && nextEnd < nextStart) {
      toast.error("任期結束日不能早於開始日");
      return;
    }
    setBusyId(position.id);
    try {
      await adminApi.updateUserPosition(user.id, position.id, {
        start_date: nextStart,
        end_date: nextEnd || null,
      });
      toast.success("任期日期已更新");
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "更新任期失敗"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (position: UserPositionRead) => {
    const accepted = await confirm({
      title: "移除幹部任期",
      description: `確定移除「${user.display_name}」的「${position.position_name}」任期？`,
      confirmLabel: "移除任期",
      danger: true,
    });
    if (!accepted) return;
    setBusyId(position.id);
    try {
      await adminApi.removeUserPosition(user.id, position.id);
      toast.success("任期已移除");
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "移除任期失敗"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Section title="幹部任期">
      <div className="grid min-w-0 gap-3 rounded-lg bg-[var(--bg-elevated)] p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="block min-w-0 text-xs text-[var(--text-muted)]">
          新增職位
          <select
            value={selectedPositionId}
            onChange={(event) => setSelectedPositionId(event.target.value)}
            className="input mt-1 min-h-11 w-full"
            disabled={loading || available.length === 0}
          >
            <option value="">{loading ? "職位載入中…" : available.length ? "選擇職位" : "沒有可指派職位"}</option>
            {available.map((position) => <option key={position.id} value={position.id}>{position.org_name} · {position.name}</option>)}
          </select>
        </label>
        <DateInput value={startDate} onChange={setStartDate} label="開始日期" />
        <DateInput value={endDate} onChange={setEndDate} label="結束日期（選填）" min={startDate} />
        <ActionButton onClick={() => void add()} disabled={adding || loading || !selectedPositionId || Boolean(endDate && endDate < startDate)} tone="primary">
          <Plus size={15} />{adding ? "新增中…" : "新增任期"}
        </ActionButton>
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]" role="status">載入任期中…</p>
      ) : loadError ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--danger-dim)] p-3" role="alert">
          <p className="text-sm text-[var(--danger)]">無法載入職位與任期。</p>
          <ActionButton onClick={() => void load()}><RefreshCcw size={15} />重新載入</ActionButton>
        </div>
      ) : assignments.length === 0 ? (
        <p className="mt-3 rounded-lg bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">此帳號尚無幹部任期。</p>
      ) : (
        <div className="mt-3 space-y-2">
          {assignments.map((position) => (
            <PositionTenureRow
              key={position.id}
              user={user}
              position={position}
              busy={busyId === position.id}
              onSave={(start, end) => save(position, start, end)}
              onRemove={() => remove(position)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}
