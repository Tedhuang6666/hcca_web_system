"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import { AccountMergeSection } from "./AccountMergeSection";
import { adminApi, apiErrorMessage, classApi } from "@/lib/api";
import type {
  AdminUserDetail,
  ClassRosterEntryOut,
  SchoolClassListItem,
} from "@/lib/types";
import { AccountLifecycleSection, AccountTenureSection } from "./AccountGovernanceSections";
import styles from "./AccountDetailPanel.module.css";

function classOptionLabel(item: SchoolClassListItem) {
  return item.academic_year + " 學年度 " + (item.label ?? (item.class_code + " 班"));
}

function rosterClassLabel(entry: AdminUserDetail["class_roster"][number]) {
  return entry.class_label ?? (entry.academic_year + " 學年度 " + entry.class_code + " 班");
}

const NOTIFICATION_LABELS: Record<string, string> = {
  document_pending: "公文待審",
  document_approved: "公文核准",
  document_rejected: "公文退回",
  document_recalled: "公文撤回",
  regulation_review_assigned: "法規排程",
  regulation_publish_ready: "法規待公布",
  regulation_published: "法規已公布",
  petition_received: "新陳情",
  petition_updated: "陳情更新",
  petition_assigned: "陳情指派",
  petition_replied: "陳情回覆",
  petition_status_updated: "陳情狀態更新",
  merchandise_submission_received: "新校商投稿",
  merchandise_submission_status: "校商投稿狀態",
  shop_order_paid: "購票付款",
  survey_invitation: "問卷邀請",
  announcement: "公告通知",
  work_item_assigned: "工作指派",
  work_item_due: "工作期限",
  system: "系統通知",
};

const MODULE_LABELS: Record<string, string> = {
  document: "公文",
  regulation: "法規",
  petition: "陳情",
  shop: "購票",
  survey: "問卷",
  announcement: "公告",
  work: "工作",
  system: "系統",
};

type ConfirmState = {
  title: string;
  body: string;
  actionLabel: string;
  action: () => Promise<void>;
} | null;

type PreferenceChannels = AdminUserDetail["notification_preferences"][string];

function Button({
  children,
  onClick,
  tone = "neutral",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "primary" | "danger" | "warning";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const style = {
    neutral: { color: "var(--text-secondary)", border: "1px solid var(--border)" },
    primary: { color: "var(--primary-fg)", background: "var(--primary)", border: "1px solid var(--primary)" },
    danger: { color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 35%, var(--border))" },
    warning: { color: "var(--warning)", border: "1px solid color-mix(in srgb, var(--warning) 35%, var(--border))" },
  }[tone];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 min-w-0 w-full rounded-lg px-3 text-sm outline-none ${props.className ?? ""}`}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        ...props.style,
      }}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-11 min-w-0 w-full rounded-lg px-3 text-sm outline-none ${props.className ?? ""}`}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        ...props.style,
      }}
    />
  );
}

function Section({
  title,
  description,
  children,
  tone = "default",
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "warning";
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className={styles.section}
      style={{
        border: tone === "warning"
          ? "1px solid color-mix(in srgb, var(--warning) 35%, var(--border))"
          : "1px solid var(--border)",
      }}
    >
      <summary className="min-h-12 cursor-pointer p-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</summary>
      <div className="min-w-0 px-4 pb-4">
        {description && <p className="mb-4 text-xs leading-5" style={{ color: "var(--text-muted)" }}>{description}</p>}
        {children}
      </div>
    </details>
  );
}

function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const colors = {
    neutral: { color: "var(--text-secondary)", background: "var(--bg-elevated)" },
    success: { color: "var(--success)", background: "var(--success-dim)" },
    warning: { color: "var(--warning)", background: "var(--warning-dim)" },
    danger: { color: "var(--danger)", background: "var(--danger-dim)" },
  }[tone];
  return <span className="rounded-full px-2 py-1 text-[11px] font-medium" style={colors}>{label}</span>;
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--bg-hover)]">
      <span className="min-w-0">
        <span className="block text-sm" style={{ color: "var(--text-primary)" }}>{label}</span>
        <span className="mt-0.5 block text-xs leading-5" style={{ color: "var(--text-muted)" }}>{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 shrink-0 accent-[var(--primary)]"
      />
    </label>
  );
}


export function AccountDetailPanel({
  user,
  users,
  classes,
  canManageClasses,
  onChanged,
}: {
  user: AdminUserDetail;
  users: AdminUserDetail[];
  classes: SchoolClassListItem[];
  canManageClasses: boolean;
  onChanged: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const runConfirm = async () => {
    if (!confirm) return;
    try {
      await confirm.action();
      toast.success("操作已完成");
      setConfirm(null);
      await onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, "操作失敗"));
    }
  };

  return (
    <>
      <AccountDetail
        user={user}
        users={users}
        classes={classes}
        canManageClasses={canManageClasses}
        onChanged={onChanged}
        onConfirm={setConfirm}
      />
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <div className="space-y-5">
            <div className="flex gap-3 rounded-lg p-3 text-sm leading-6" style={{ background: "var(--warning-dim)", color: "var(--text-secondary)" }}>
              <AlertTriangle size={18} className="mt-1 shrink-0" style={{ color: "var(--warning)" }} />
              <p>{confirm.body}</p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => setConfirm(null)}>取消</Button>
              <Button onClick={runConfirm} tone="danger">{confirm.actionLabel}</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function AccountDetail({
  user,
  users,
  classes,
  canManageClasses,
  onChanged,
  onConfirm,
}: {
  user: AdminUserDetail;
  users: AdminUserDetail[];
  classes: SchoolClassListItem[];
  canManageClasses: boolean;
  onChanged: () => Promise<void>;
  onConfirm: (state: ConfirmState) => void;
}) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [studentId, setStudentId] = useState(user.student_id ?? "");
  const [isVerified, setIsVerified] = useState(user.is_verified);
  const [showEmail, setShowEmail] = useState(user.show_email);
  const [theme, setTheme] = useState<AdminUserDetail["ui_theme"]>(user.ui_theme);
  const [digest, setDigest] = useState(user.notification_digest_frequency);
  const [mutedModules, setMutedModules] = useState(user.muted_notification_modules);
  const [preferences, setPreferences] = useState(user.notification_preferences);
  const [emailAlias, setEmailAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [rosterClassId, setRosterClassId] = useState("");
  const [rosterSeatNumber, setRosterSeatNumber] = useState("");
  const [rosterEntries, setRosterEntries] = useState<ClassRosterEntryOut[]>([]);
  const [rosterEntriesLoading, setRosterEntriesLoading] = useState(false);
  const [rosterEntriesError, setRosterEntriesError] = useState(false);
  const [rosterSaving, setRosterSaving] = useState(false);

  useEffect(() => {
    setDisplayName(user.display_name);
    setStudentId(user.student_id ?? "");
    setIsVerified(user.is_verified);
    setShowEmail(user.show_email);
    setTheme(user.ui_theme);
    setDigest(user.notification_digest_frequency);
    setMutedModules(user.muted_notification_modules);
    setPreferences(user.notification_preferences);
  }, [user]);

  useEffect(() => {
    const currentRoster = user.class_roster.find(
      (entry) => entry.is_active && classes.some((item) => item.id === entry.class_id),
    );
    setRosterClassId(currentRoster?.class_id ?? "");
    setRosterSeatNumber(currentRoster ? String(currentRoster.seat_number) : "");
  }, [classes, user]);

  useEffect(() => {
    if (!canManageClasses || !rosterClassId) {
      setRosterEntries([]);
      setRosterEntriesLoading(false);
      setRosterEntriesError(false);
      return;
    }

    let cancelled = false;
    setRosterEntries([]);
    setRosterEntriesLoading(true);
    setRosterEntriesError(false);
    void classApi.roster(rosterClassId)
      .then((entries) => {
        if (!cancelled) setRosterEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setRosterEntriesError(true);
      })
      .finally(() => {
        if (!cancelled) setRosterEntriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canManageClasses, rosterClassId]);

  const matchingRosterEntry = rosterEntries.find(
    (entry) => entry.user_id === user.id || (user.student_id && entry.student_id === user.student_id),
  );
  const seatLimit = Math.max(50, ...rosterEntries.map((entry) => entry.seat_number));
  const availableSeatNumbers = Array.from({ length: seatLimit + 1 }, (_, index) => index + 1)
    .filter((seatNumber) => rosterEntries.every(
      (entry) => entry.seat_number !== seatNumber || entry.id === matchingRosterEntry?.id,
    ));

  const updatePreference = (type: string, channel: keyof PreferenceChannels, checked: boolean) => {
    setPreferences((current) => ({
      ...current,
      [type]: { ...current[type], [channel]: checked },
    }));
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await adminApi.updateUser(user.id, {
        display_name: displayName.trim(),
        student_id: studentId.trim() || null,
        is_verified: isVerified,
        show_email: showEmail,
        ui_theme: theme,
        notification_preferences: preferences,
        notification_digest_frequency: digest,
        muted_notification_modules: mutedModules,
      });
      toast.success("帳號設定已儲存");
      await onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, "儲存帳號設定失敗"));
    } finally {
      setSaving(false);
    }
  };

  const saveClassRoster = async () => {
    const seatNumberValue = Number(rosterSeatNumber);
    if (!rosterClassId || !Number.isInteger(seatNumberValue) || seatNumberValue < 1) return;
    if (rosterEntriesLoading || rosterEntriesError) return;

    setRosterSaving(true);
    try {
      if (matchingRosterEntry) {
        await classApi.updateRoster(rosterClassId, matchingRosterEntry.id, {
          seat_number: seatNumberValue,
        });
      } else if (user.student_id) {
        await classApi.addRoster(rosterClassId, {
          seat_number: seatNumberValue,
          student_id: user.student_id,
        });
      } else {
        toast.error("請先在基本資料儲存學號，再新增班級名冊。");
        return;
      }
      toast.success("班級與座號已更新");
      await onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, "更新班級與座號失敗"));
    } finally {
      setRosterSaving(false);
    }
  };

  const linkEmails = async () => {
    const emails = emailAlias.split(/[,，;\s]+/).map((value) => value.trim()).filter(Boolean);
    if (!emails.length) return;
    setWorking(true);
    try {
      await adminApi.linkUserEmails(user.id, emails);
      toast.success("登入 Email 已連結");
      setEmailAlias("");
      await onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error, "連結 Email 失敗"));
    } finally {
      setWorking(false);
    }
  };

  const clearMfa = () => onConfirm({
    title: "清除 2FA 設定",
    body: `這會清除「${user.display_name}」的 TOTP 秘密與備援碼；使用者下一次登入後需要重新註冊驗證器。既有 Passkey 不受影響。`,
    actionLabel: "清除 2FA",
    action: async () => { await adminApi.clearUserMfa(user.id); },
  });

  const revokeSessions = () => onConfirm({
    title: "撤銷全部登入工作階段",
    body: `這會讓「${user.display_name}」目前所有裝置的登入憑證立即失效，包含背景工作中的工作階段。使用者需要重新登入。`,
    actionLabel: "撤銷全部登入",
    action: async () => { const result = await adminApi.revokeUserSessions(user.id); toast.success(`已撤銷 ${result.revoked_count} 個登入憑證`); },
  });

  const toggleSuperuser = () => onConfirm({
    title: user.is_superuser ? "取消超級管理員" : "設定超級管理員",
    body: `確定要${user.is_superuser ? "取消" : "賦予"}「${user.display_name}」超級管理員身分？此身分會跳過所有 RBAC 檢查。`,
    actionLabel: user.is_superuser ? "取消超管" : "設定超管",
    action: async () => { await adminApi.updateUser(user.id, { is_superuser: !user.is_superuser }); },
  });


  return (
    <div className={styles.root}>
      <header className="flex min-w-0 flex-col gap-4 border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}><UserRound size={22} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{user.display_name}</h2>
              {user.is_active ? <StatusBadge label="啟用中" tone="success" /> : <StatusBadge label="已停用" tone="danger" />}
              {user.is_verified && <StatusBadge label="已驗證" tone="success" />}
            </div>
            <p className="mt-1 break-all text-sm" style={{ color: "var(--text-secondary)" }}>{user.email}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>建立於 {new Date(user.created_at).toLocaleDateString("zh-TW")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={saveSettings} tone="primary" disabled={saving || !displayName.trim()}><Check size={16} />{saving ? "儲存中…" : "儲存設定"}</Button>
        </div>
      </header>

      <div className="min-w-0 space-y-3">
        <div className="space-y-4">
          <Section defaultOpen title="基本資料與帳號設定" description="可調整管理資料與登入偏好；主要登入 Email 僅供識別，請透過連結登入身分處理帳號歸戶。">
            <div className={styles.twoColumns}>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>顯示姓名<TextInput className="mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>學號<TextInput className="mt-1" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="留白可清除" /></label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>介面主題<SelectInput className="mt-1" value={theme} onChange={(event) => setTheme(event.target.value as AdminUserDetail["ui_theme"])}><option value="auto">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></SelectInput></label>
            </div>
            <div className="mt-3 grid gap-1 rounded-lg" style={{ background: "var(--bg-elevated)" }}>
              <ToggleRow label="Email 已驗證" hint="調整外部帳號的信任狀態；請確認來源後再變更。" checked={isVerified} onChange={setIsVerified} />
              <ToggleRow label="允許對外顯示 Email" hint="影響公開人員資料與承辦人資訊的 Email 顯示。" checked={showEmail} onChange={setShowEmail} />
            </div>
          </Section>

          <Section title="學籍與幹部任期">
            <div className={styles.governance}>
              <AccountLifecycleSection user={user} onChanged={onChanged} />
              <AccountTenureSection user={user} onChanged={onChanged} />
            </div>
          </Section>

          <Section title="班級與座號" description="查看目前及歷史名冊資料，並在此快速新增班級或調整座號。">
            {user.class_roster.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無班級座號名冊資料。</p>
            ) : (
              <div className="space-y-2">
                {user.class_roster.map((entry) => (
                  <div key={`${entry.class_id}-${entry.student_id}-${entry.seat_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5" style={{ background: "var(--bg-elevated)" }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {rosterClassLabel(entry)}
                      </p>
                      <p className="mt-1 break-all text-xs" style={{ color: "var(--text-muted)" }}>
                        {entry.academic_year} 學年度 · 學號 {entry.student_id}
                      </p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: entry.is_active ? "var(--primary-dim)" : "var(--bg-surface)", color: entry.is_active ? "var(--primary)" : "var(--text-muted)" }}>
                      {entry.is_active ? "目前班級" : "歷史班級"} · {entry.seat_number} 號
                    </span>
                  </div>
                ))}
              </div>
            )}
            {canManageClasses && (
              <div className="mt-4 space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <div className={styles.rosterForm}>
                  <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                    班級
                    <SelectInput
                      className="mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                      value={rosterClassId}
                      onChange={(event) => {
                        const nextClassId = event.target.value;
                        const currentEntry = user.class_roster.find((entry) => entry.class_id === nextClassId);
                        setRosterClassId(nextClassId);
                        setRosterSeatNumber(currentEntry ? String(currentEntry.seat_number) : "");
                        setRosterEntries([]);
                        setRosterEntriesLoading(Boolean(nextClassId));
                        setRosterEntriesError(false);
                      }}
                      disabled={rosterSaving || classes.length === 0}
                      aria-label="快速設定班級"
                    >
                      <option value="">選擇班級</option>
                      {classes.map((item) => (
                        <option key={item.id} value={item.id}>{classOptionLabel(item)}</option>
                      ))}
                    </SelectInput>
                  </label>
                  <label className="text-xs" style={{ color: "var(--text-muted)" }}>
                    座號
                    <SelectInput
                      className="mt-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                      value={rosterSeatNumber}
                      onChange={(event) => setRosterSeatNumber(event.target.value)}
                      disabled={!rosterClassId || rosterEntriesLoading || rosterEntriesError || rosterSaving}
                      aria-label="快速設定座號"
                    >
                      <option value="">選擇座號</option>
                      {availableSeatNumbers.map((seatNumber) => (
                        <option key={seatNumber} value={seatNumber}>{seatNumber} 號</option>
                      ))}
                    </SelectInput>
                  </label>
                  <Button
                    onClick={saveClassRoster}
                    tone="primary"
                    disabled={
                      !rosterClassId
                      || !rosterSeatNumber
                      || (!matchingRosterEntry && !user.student_id)
                      || rosterEntriesLoading
                      || rosterEntriesError
                      || rosterSaving
                    }
                    className="w-full sm:w-auto"
                  >
                    <Check size={15} />{rosterSaving ? "儲存中…" : "儲存班級座號"}
                  </Button>
                </div>
                {classes.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前沒有啟用中的班級可選。</p>
                )}
                {rosterEntriesLoading && (
                  <p className="text-xs" role="status" style={{ color: "var(--text-muted)" }}>正在載入座號名冊…</p>
                )}
                {rosterEntriesError && (
                  <p className="text-xs" role="alert" style={{ color: "var(--danger)" }}>
                    無法讀取該班名冊，請重新選擇班級或重新整理頁面。
                  </p>
                )}
                {!user.student_id && !matchingRosterEntry && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    新增名冊需要學號；請先在基本資料儲存學號。
                  </p>
                )}
              </div>
            )}
            <Link href="/admin/people?section=classes" className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-medium" style={{ color: "var(--primary)" }}>
              管理班級名冊與座號<ChevronRight size={14} />
            </Link>
          </Section>

          <Section title="登入身分與帳號連結" description="所有已連結的 Email 都可以登入同一個主要帳戶；連結前請確認信箱確實屬於此人。">
            <div className="space-y-2">
              {user.linked_emails.map((email, index) => <div key={email} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}><Mail size={15} style={{ color: "var(--text-muted)" }} /><span className="min-w-0 flex-1 break-all">{email}</span>{index === 0 && <StatusBadge label="主要" tone="success" />}</div>)}
            </div>
            <div className={styles.emailForm}>
              <TextInput value={emailAlias} onChange={(event) => setEmailAlias(event.target.value)} placeholder="name@gmail.com，可用逗號分隔多筆" />
              <Button onClick={linkEmails} tone="primary" disabled={working || !emailAlias.trim()} className="shrink-0"><Link2 size={15} />連結 Email</Button>
            </div>
          </Section>

          <Section title="通知偏好" description="調整通知管道後，按上方「儲存設定」套用。">
            <div className={`${styles.twoColumns} mb-4`}>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Email 摘要頻率<SelectInput className="mt-1" value={digest} onChange={(event) => setDigest(event.target.value as typeof digest)}><option value="off">關閉摘要</option><option value="daily">每日摘要</option><option value="weekly">每週摘要</option></SelectInput></label>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>已靜音模組<div className="mt-1 flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg px-3" style={{ border: "1px solid var(--border)" }}>{Object.entries(MODULE_LABELS).map(([key, label]) => <button type="button" key={key} onClick={() => setMutedModules((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} aria-pressed={mutedModules.includes(key)} aria-label={`${label}通知靜音`} className="min-h-11 rounded-lg px-2 py-1 text-xs" style={{ background: mutedModules.includes(key) ? "var(--warning-dim)" : "var(--bg-elevated)", color: mutedModules.includes(key) ? "var(--warning)" : "var(--text-muted)" }}>{label}</button>)}</div></div>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {Object.entries(preferences).map(([type, channels]) => (
                <fieldset key={type} className="min-w-0 py-3" style={{ borderColor: "var(--border)" }}>
                  <legend className="float-left mb-2 w-full break-words text-sm font-medium" style={{ color: "var(--text-primary)" }}>{NOTIFICATION_LABELS[type] ?? type}</legend>
                  <div className={styles.channels}>
                    {([ ["inapp", "站內"], ["email", "Email"], ["line", "LINE"], ["discord", "Discord"] ] as const).map(([channel, label]) => (
                      <label key={channel} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                        <input type="checkbox" checked={channels[channel]} onChange={(event) => updatePreference(type, channel, event.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--primary)]" aria-label={`${NOTIFICATION_LABELS[type] ?? type} ${label}`} />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          </Section>

          <Section title="合併重複帳號" tone="warning">
            <div className={styles.governance}>
              <AccountMergeSection key={user.id} user={user} users={users} onChanged={onChanged} />
            </div>
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="安全維護" description="這些操作會影響登入或驗證狀態，系統會寫入稽核日誌。">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm" style={{ color: "var(--text-primary)" }}>超級管理員權限</p>
                <Button onClick={toggleSuperuser} tone="warning" disabled={user.is_owner && user.is_superuser}><KeyRound size={15} />{user.is_superuser ? "取消超管" : "設定超管"}</Button>
              </div>
              <div className="flex items-start gap-3"><ShieldCheck size={17} className="mt-0.5" style={{ color: user.mfa_enabled ? "var(--success)" : "var(--text-muted)" }} /><div className="min-w-0 flex-1"><p className="text-sm" style={{ color: "var(--text-primary)" }}>兩步驟驗證</p><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{user.mfa_enabled ? "TOTP 已啟用" : "目前未啟用"}</p><Button onClick={clearMfa} tone="danger" disabled={!user.mfa_enabled} className="mt-2 w-full"><ShieldAlert size={15} />清除 2FA</Button></div></div>
              <div className="flex items-start gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}><LogOut size={17} className="mt-0.5" style={{ color: "var(--warning)" }} /><div className="min-w-0 flex-1"><p className="text-sm" style={{ color: "var(--text-primary)" }}>全部登入工作階段</p><p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>撤銷目前所有裝置的登入憑證，使用者需重新登入。</p><Button onClick={revokeSessions} tone="warning" className="mt-2 w-full"><LogOut size={15} />清除全部登入</Button></div></div>
            </div>
          </Section>

          <Section title="目前身分與權限">
            <div className="space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <p>學號：{user.student_id ?? "未設定"}</p>
              <p>職位：{user.positions.length} 個</p>
              <p>有效權限：{user.is_superuser ? "超管（全部權限）" : `${user.effective_permissions.length} 個`}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">{user.positions.slice(0, 6).map((position) => <span key={position.user_position_id ?? position.id} className="rounded-full px-2 py-1 text-[11px]" style={{ background: "var(--primary-dim)", color: "var(--primary-text)" }}>{position.name}</span>)}</div>
            <Link href="/admin/people?section=organization" className="mt-4 inline-flex min-h-11 items-center gap-1 text-xs font-medium" style={{ color: "var(--primary)" }}>前往組織與職位管理<ChevronRight size={14} /></Link>
          </Section>
        </aside>
      </div>


    </div>
  );
}
