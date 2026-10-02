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
import { adminApi, apiErrorMessage } from "@/lib/api";
import type { AccountMergeConflict, AdminUserDetail } from "@/lib/types";

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
      className={`min-h-11 w-full rounded-lg px-3 text-sm outline-none ${props.className ?? ""}`}
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
      className={`min-h-11 w-full rounded-lg px-3 text-sm outline-none ${props.className ?? ""}`}
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
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{
        border: tone === "warning"
          ? "1px solid color-mix(in srgb, var(--warning) 35%, var(--border))"
          : "1px solid var(--border)",
      }}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
        {description && <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>{description}</p>}
      </div>
      {children}
    </section>
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
  onChanged,
}: {
  user: AdminUserDetail;
  users: AdminUserDetail[];
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
      <AccountDetail user={user} users={users} onChanged={onChanged} onConfirm={setConfirm} />
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
  onChanged,
  onConfirm,
}: {
  user: AdminUserDetail;
  users: AdminUserDetail[];
  onChanged: () => Promise<void>;
  onConfirm: (state: ConfirmState) => void;
}) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [studentId, setStudentId] = useState(user.student_id ?? "");
  const [isActive, setIsActive] = useState(user.is_active);
  const [isVerified, setIsVerified] = useState(user.is_verified);
  const [showEmail, setShowEmail] = useState(user.show_email);
  const [theme, setTheme] = useState<AdminUserDetail["ui_theme"]>(user.ui_theme);
  const [digest, setDigest] = useState(user.notification_digest_frequency);
  const [mutedModules, setMutedModules] = useState(user.muted_notification_modules);
  const [preferences, setPreferences] = useState(user.notification_preferences);
  const [emailAlias, setEmailAlias] = useState("");
  const [mergePrimaryId, setMergePrimaryId] = useState(user.id);
  const [mergeSourceIds, setMergeSourceIds] = useState<string[]>([]);
  const [mergeConflicts, setMergeConflicts] = useState<AccountMergeConflict[]>([]);
  const [mergeChoices, setMergeChoices] = useState<Record<string, string>>({});
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setDisplayName(user.display_name);
    setStudentId(user.student_id ?? "");
    setIsActive(user.is_active);
    setIsVerified(user.is_verified);
    setShowEmail(user.show_email);
    setTheme(user.ui_theme);
    setDigest(user.notification_digest_frequency);
    setMutedModules(user.muted_notification_modules);
    setPreferences(user.notification_preferences);
    setMergePrimaryId(user.id);
    setMergeSourceIds([]);
    setMergeConflicts([]);
    setMergeChoices({});
    setMergeModalOpen(false);
  }, [user]);

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
        is_active: isActive,
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

  const mergePrimary = users.find((candidate) => candidate.id === mergePrimaryId) ?? user;
  const mergeSources = users.filter(
    (candidate) => candidate.id !== mergePrimaryId && mergeSourceIds.includes(candidate.id),
  );
  const selectedSourceIds = mergeSources.map((source) => source.id);
  const previewMerge = async () => {
    if (!selectedSourceIds.length) return;
    setWorking(true);
    try {
      const preview = await adminApi.previewUserMerge(mergePrimaryId, selectedSourceIds);
      if (!preview.conflicts.length) {
        setMergeConflicts([]);
        setMergeModalOpen(false);
        confirmMerge({});
        return;
      }
      setMergeConflicts(preview.conflicts);
      setMergeChoices(Object.fromEntries(
        preview.conflicts
          .filter((conflict) => conflict.resolvable)
          .map((conflict) => [
            conflict.key,
            conflict.records.find((record) => record.side === "target")?.id
              ?? conflict.records[0]?.id,
          ]),
      ));
      setMergeModalOpen(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, "預覽帳戶合併失敗"));
    } finally {
      setWorking(false);
    }
  };

  const confirmMerge = (conflictResolutions: Record<string, string>) => onConfirm({
    title: "合併帳戶並歸戶歷史資料",
    body: `確定將${mergeSources.map((source) => `「${source.display_name}」`).join("、")}合併到主要帳戶「${mergePrimary.display_name}」？名稱、UUID、學號等帳號資料會沿用主要帳戶；此操作會停用次要帳戶且不可逆。`,
    actionLabel: "合併帳戶",
    action: async () => { await adminApi.mergeUserAccounts(mergePrimaryId, selectedSourceIds, conflictResolutions); },
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: "var(--border)" }}>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--primary-dim)", color: "var(--primary)" }}><UserRound size={22} /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{user.display_name}</h2>
              {user.is_active ? <StatusBadge label="啟用中" tone="success" /> : <StatusBadge label="已停用" tone="danger" />}
              {user.is_verified && <StatusBadge label="已驗證" tone="success" />}
            </div>
            <p className="mt-1 break-all text-sm" style={{ color: "var(--text-secondary)" }}>{user.email}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>建立於 {new Date(user.created_at).toLocaleDateString("zh-TW")} · ID {user.id}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={toggleSuperuser} tone="warning" disabled={user.is_owner && user.is_superuser}><KeyRound size={15} />{user.is_superuser ? "取消超管" : "設定超管"}</Button>
          <Button onClick={saveSettings} tone="primary" disabled={saving || !displayName.trim()}><Check size={16} />{saving ? "儲存中…" : "儲存設定"}</Button>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <Section title="基本資料與帳號狀態" description="可調整管理資料與登入狀態；主要登入 Email 僅供識別，請透過連結登入身分處理帳號歸戶。">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>顯示姓名<TextInput className="mt-1" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>學號<TextInput className="mt-1" value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="留白可清除" /></label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>介面主題<SelectInput className="mt-1" value={theme} onChange={(event) => setTheme(event.target.value as AdminUserDetail["ui_theme"])}><option value="auto">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></SelectInput></label>
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>介面語言<SelectInput className="mt-1" value={user.ui_locale} disabled><option value="zh-TW">繁體中文</option></SelectInput></label>
            </div>
            <div className="mt-3 grid gap-1 rounded-lg" style={{ background: "var(--bg-elevated)" }}>
              <ToggleRow label="帳號啟用" hint="停用後無法使用任何登入憑證。" checked={isActive} onChange={setIsActive} />
              <ToggleRow label="Email 已驗證" hint="調整外部帳號的信任狀態；請確認來源後再變更。" checked={isVerified} onChange={setIsVerified} />
              <ToggleRow label="允許對外顯示 Email" hint="影響公開人員資料與承辦人資訊的 Email 顯示。" checked={showEmail} onChange={setShowEmail} />
            </div>
          </Section>

          <Section title="班級與座號" description="依班級座號名冊顯示目前及歷史資料；如需調整，請到班級與名冊管理。">
            {user.class_roster.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>尚無班級座號名冊資料。</p>
            ) : (
              <div className="space-y-2">
                {user.class_roster.map((entry) => (
                  <div key={`${entry.class_id}-${entry.student_id}-${entry.seat_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5" style={{ background: "var(--bg-elevated)" }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {entry.class_label ?? `${entry.academic_year} 學年度 ${entry.class_code} 班`}
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
            <Link href="/admin/people?section=classes" className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-medium" style={{ color: "var(--primary)" }}>
              管理班級名冊與座號<ChevronRight size={14} />
            </Link>
          </Section>

          <Section title="登入身分與帳號連結" description="所有已連結的 Email 都可以登入同一個主要帳戶；連結前請確認信箱確實屬於此人。">
            <div className="space-y-2">
              {user.linked_emails.map((email, index) => <div key={email} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm" style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}><Mail size={15} style={{ color: "var(--text-muted)" }} /><span className="min-w-0 flex-1 break-all">{email}</span>{index === 0 && <StatusBadge label="主要" tone="success" />}</div>)}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <TextInput value={emailAlias} onChange={(event) => setEmailAlias(event.target.value)} placeholder="name@gmail.com，可用逗號分隔多筆" />
              <Button onClick={linkEmails} tone="primary" disabled={working || !emailAlias.trim()} className="shrink-0"><Link2 size={15} />連結 Email</Button>
            </div>
          </Section>

          <Section title="通知偏好" description="可代替使用者調整站內、Email、LINE 與 Discord 通知；儲存後立即生效。">
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs" style={{ color: "var(--text-muted)" }}>Email 摘要頻率<SelectInput className="mt-1" value={digest} onChange={(event) => setDigest(event.target.value as typeof digest)}><option value="off">關閉摘要</option><option value="daily">每日摘要</option><option value="weekly">每週摘要</option></SelectInput></label>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>已靜音模組<div className="mt-1 flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg px-3" style={{ border: "1px solid var(--border)" }}>{Object.entries(MODULE_LABELS).map(([key, label]) => <button type="button" key={key} onClick={() => setMutedModules((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} className="rounded-full px-2 py-1 text-[11px]" style={{ background: mutedModules.includes(key) ? "var(--warning-dim)" : "var(--bg-elevated)", color: mutedModules.includes(key) ? "var(--warning)" : "var(--text-muted)" }}>{label}</button>)}</div></div>
            </div>
            <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
              <table className="w-full min-w-[640px] text-left text-xs"><thead style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}><tr><th className="px-3 py-2 font-medium">通知類型</th><th className="px-3 py-2 text-center font-medium">站內</th><th className="px-3 py-2 text-center font-medium">Email</th><th className="px-3 py-2 text-center font-medium">LINE</th><th className="px-3 py-2 text-center font-medium">Discord</th></tr></thead><tbody>{Object.entries(preferences).map(([type, channels]) => <tr key={type} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-3 py-2.5" style={{ color: "var(--text-primary)" }}>{NOTIFICATION_LABELS[type] ?? type}</td>{(["inapp", "email", "line", "discord"] as const).map((channel) => <td key={channel} className="px-3 py-2.5 text-center"><input type="checkbox" checked={channels[channel]} onChange={(event) => updatePreference(type, channel, event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" aria-label={`${NOTIFICATION_LABELS[type] ?? type} ${channel}`} /></td>)}</tr>)}</tbody></table>
            </div>
          </Section>

          <Section title="帳戶合併與歸戶" description="先選擇要保留名稱、UUID、學號與內部帳號資料的主要帳戶，再選擇要歸戶的次要帳戶。明確的投稿等業務資料衝突會停止合併並通知管理員。" tone="warning">
            <label className="block text-xs" style={{ color: "var(--text-muted)" }}>
              主要帳戶（沿用其帳號資料）
              <SelectInput
                className="mt-1"
                value={mergePrimaryId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setMergePrimaryId(nextId);
                  setMergeSourceIds((current) => current.filter((id) => id !== nextId));
                }}
              >
                {users.filter((candidate) => candidate.is_active).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name} · {candidate.student_id ?? candidate.email}</option>)}
              </SelectInput>
            </label>
            <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>選擇要併入主要帳戶的次要帳戶：</p>
            <div className="max-h-52 overflow-y-auto rounded-lg p-2" style={{ border: "1px solid var(--border)" }}>
              {users.filter((candidate) => candidate.id !== mergePrimaryId && candidate.is_active).map((candidate) => <label key={candidate.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-xs hover:bg-[var(--bg-hover)]" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={mergeSourceIds.includes(candidate.id)} onChange={(event) => setMergeSourceIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} className="h-4 w-4 accent-[var(--primary)]" /><span className="min-w-0 truncate">{candidate.display_name} · {candidate.student_id ?? candidate.email}</span></label>)}
            </div>
            <Button onClick={previewMerge} tone="warning" disabled={working || !selectedSourceIds.length} className="mt-3"><Link2 size={15} />檢查衝突並合併{selectedSourceIds.length ? `（${selectedSourceIds.length}）` : ""}</Button>
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="安全維護" description="這些操作會影響登入或驗證狀態，系統會寫入稽核日誌。">
            <div className="space-y-3">
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

      {mergeModalOpen && (
        <Modal title="選擇要保留的資料" onClose={() => setMergeModalOpen(false)} size="2xl">
          <div className="space-y-4">
            <p className="text-sm leading-6" style={{ color: "var(--text-secondary)" }}>
              可安全去重的資料請選擇要保留的紀錄；政策同意等冪等資料會由系統自動保留主要帳戶的紀錄。投稿等業務資料仍需先在原模組處理。
            </p>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {mergeConflicts.map((conflict) => (
                <fieldset key={conflict.key} className="space-y-2 rounded-lg p-3" style={{ border: "1px solid var(--border)" }}>
                  <legend className="px-1 text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{conflict.title}</legend>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{conflict.message}</p>
                  {conflict.resolvable ? conflict.records.map((record) => (
                    <label key={record.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2" style={{ background: mergeChoices[conflict.key] === record.id ? "var(--primary-dim)" : "var(--bg-elevated)" }}>
                      <input
                        type="radio"
                        name={conflict.key}
                        checked={mergeChoices[conflict.key] === record.id}
                        onChange={() => setMergeChoices((current) => ({ ...current, [conflict.key]: record.id }))}
                        className="mt-1 h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="text-xs leading-5" style={{ color: "var(--text-secondary)" }}>
                        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{record.side === "target" ? "主要帳戶" : "次要帳戶"}：{record.owner_name}</span>
                        <br />{record.label}
                      </span>
                    </label>
                  )) : (
                    <p className="rounded-md p-2 text-xs leading-5" style={{ background: "var(--warning-dim)", color: "var(--text-secondary)" }}>
                      這類資料不能在帳戶合併時直接刪除，請先在對應業務模組處理。
                    </p>
                  )}
                </fieldset>
              ))}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button onClick={() => setMergeModalOpen(false)}>關閉</Button>
              {!mergeConflicts.some((conflict) => !conflict.resolvable) && (
                <Button onClick={() => { setMergeModalOpen(false); confirmMerge(mergeChoices); }} tone="warning">
                  選擇後繼續合併
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
