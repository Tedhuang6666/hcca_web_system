"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePermissions } from "@/hooks/usePermissions";
import {
  apiErrorMessage,
  systemApi,
  type DefenseRule,
  type DefenseRuleType,
  type SystemFeatureFlag,
} from "@/lib/api";
import { blockUserAccount, previewUserBlock, type UserBlockPreview } from "@/lib/user-block-api";

const RULE_TYPES: DefenseRuleType[] = [
  "ip_block",
  "cidr_block",
  "ip_allow",
  "user_block",
  "email_block",
  "rate_limit_override",
  "endpoint_lockdown",
  "bot_challenge_placeholder",
];

const RULE_TYPE_LABEL: Record<DefenseRuleType, string> = {
  ip_block: "IP 封鎖",
  cidr_block: "CIDR 封鎖",
  ip_allow: "IP/CIDR 白名單",
  user_block: "使用者封鎖",
  email_block: "Email 封鎖",
  rate_limit_override: "端點限流",
  endpoint_lockdown: "端點鎖定",
  bot_challenge_placeholder: "Bot Challenge 預留",
};

function toDateTimeLocal(seconds: number | null): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
}

function expirationLabel(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toLocaleString() : "永久";
}

function StatusLabel({ active }: { active: boolean }) {
  const color = active ? "var(--success)" : "var(--text-muted)";
  return (
    <span className="inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-semibold" style={{ borderColor: color, color }}>
      {active ? "啟用" : "停用"}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export default function UserAndFeatureActionsPanel() {
  const { isAdmin } = usePermissions();
  const confirm = useConfirm();
  const [rules, setRules] = useState<DefenseRule[]>([]);
  const [flags, setFlags] = useState<SystemFeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [ruleType, setRuleType] = useState<DefenseRuleType>("ip_block");
  const [ruleTarget, setRuleTarget] = useState("");
  const [ruleReason, setRuleReason] = useState("");
  const [ruleTtlMinutes, setRuleTtlMinutes] = useState(60);
  const [ruleConfigRequests, setRuleConfigRequests] = useState(30);
  const [ruleConfigWindowSeconds, setRuleConfigWindowSeconds] = useState(60);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingRuleType, setEditingRuleType] = useState<DefenseRuleType>("ip_block");
  const [editingRuleTarget, setEditingRuleTarget] = useState("");
  const [editingRuleReason, setEditingRuleReason] = useState("");
  const [editingRuleExpiresAt, setEditingRuleExpiresAt] = useState("");
  const [editingRuleRequests, setEditingRuleRequests] = useState(30);
  const [editingRuleWindowSeconds, setEditingRuleWindowSeconds] = useState(60);
  const [blockUserIdentifier, setBlockUserIdentifier] = useState("");
  const [blockUserReason, setBlockUserReason] = useState("");
  const [blockUserPreview, setBlockUserPreview] = useState<UserBlockPreview | null>(null);
  const [blockUserEmails, setBlockUserEmails] = useState(true);
  const [blockUserIps, setBlockUserIps] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [revokeUserId, setRevokeUserId] = useState("");

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const [rulesResult, flagsResult] = await Promise.allSettled([
      systemApi.listDefenseRules({ limit: 200 }),
      systemApi.listFeatureFlags(),
    ]);

    const failures: unknown[] = [];
    if (rulesResult.status === "fulfilled") setRules(rulesResult.value);
    else failures.push(rulesResult.reason);
    if (flagsResult.status === "fulfilled") setFlags(flagsResult.value);
    else failures.push(flagsResult.reason);

    setLoadError(failures.length ? apiErrorMessage(failures[0], "部分防護設定無法載入") : null);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRule = async () => {
    if (!ruleTarget.trim()) return;
    setWorking(true);
    try {
      await systemApi.createDefenseRule({
        rule_type: ruleType,
        target: ruleTarget.trim(),
        reason: ruleReason.trim(),
        config: ruleType === "rate_limit_override"
          ? { requests: ruleConfigRequests, window_seconds: ruleConfigWindowSeconds }
          : {},
        expires_at: ruleTtlMinutes > 0
          ? new Date(Date.now() + ruleTtlMinutes * 60_000).toISOString()
          : null,
      });
      toast.success("防禦規則已建立");
      setRuleTarget("");
      setRuleReason("");
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "建立規則失敗"));
    } finally {
      setWorking(false);
    }
  };

  const startEditingRule = (rule: DefenseRule) => {
    setEditingRuleId(rule.id);
    setEditingRuleType(rule.rule_type);
    setEditingRuleTarget(rule.target);
    setEditingRuleReason(rule.reason);
    setEditingRuleExpiresAt(toDateTimeLocal(rule.expires_at));
    setEditingRuleRequests(Number(rule.config.requests ?? 30));
    setEditingRuleWindowSeconds(Number(rule.config.window_seconds ?? 60));
  };

  const saveRule = async () => {
    if (!editingRuleId || !editingRuleTarget.trim()) return;
    setWorking(true);
    const expiresAt = fromDateTimeLocal(editingRuleExpiresAt);
    try {
      await systemApi.updateDefenseRule(editingRuleId, {
        rule_type: editingRuleType,
        target: editingRuleTarget.trim(),
        reason: editingRuleReason.trim(),
        expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        config: editingRuleType === "rate_limit_override"
          ? { requests: editingRuleRequests, window_seconds: editingRuleWindowSeconds }
          : {},
      });
      toast.success("防禦規則已更新");
      setEditingRuleId(null);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "更新規則失敗"));
    } finally {
      setWorking(false);
    }
  };

  const setRuleActive = async (rule: DefenseRule, isActive: boolean) => {
    if (!isActive && !(await confirm({
      title: "停用這條防禦規則？",
      description: "停用後，這條規則不會再保護平台流量。",
      confirmLabel: "停用規則",
      danger: true,
    }))) return;
    setWorking(true);
    try {
      await systemApi.updateDefenseRule(rule.id, { is_active: isActive });
      toast.success(isActive ? "防禦規則已重新啟用" : "防禦規則已停用");
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, isActive ? "重新啟用規則失敗" : "停用規則失敗"));
    } finally {
      setWorking(false);
    }
  };

  const previewUser = async () => {
    if (!blockUserIdentifier.trim()) return;
    setPreviewLoading(true);
    try {
      setBlockUserPreview(await previewUserBlock(blockUserIdentifier.trim()));
    } catch (error) {
      setBlockUserPreview(null);
      toast.error(apiErrorMessage(error, "找不到使用者"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const blockUser = async () => {
    if (!blockUserIdentifier.trim() || !blockUserReason.trim()) return;
    if (!(await confirm({
      title: "確定封鎖使用者？",
      description: `${blockUserPreview?.email ?? blockUserIdentifier} 會被封鎖，既有工作階段也會撤銷。`,
      confirmLabel: "封鎖使用者",
      danger: true,
    }))) return;
    setWorking(true);
    try {
      const result = await blockUserAccount({
        identifier: blockUserIdentifier.trim(),
        reason: blockUserReason.trim(),
        include_emails: blockUserEmails,
        include_ips: blockUserIps,
      });
      toast.success(`已封鎖 ${result.email}，建立 ${result.rules.length} 條規則`);
      setBlockUserIdentifier("");
      setBlockUserReason("");
      setBlockUserPreview(null);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "封鎖使用者失敗"));
    } finally {
      setWorking(false);
    }
  };

  const revokeUser = async () => {
    if (!revokeUserId.trim()) return;
    if (!(await confirm({
      title: "強制登出使用者？",
      description: `使用者 ${revokeUserId} 的所有工作階段會立即撤銷。`,
      confirmLabel: "強制登出",
      danger: true,
    }))) return;
    setWorking(true);
    try {
      const result = await systemApi.revokeUserTokens(revokeUserId.trim());
      toast.success(`已撤銷 ${result.revoked_count} 個 token`);
      setRevokeUserId("");
    } catch (error) {
      toast.error(apiErrorMessage(error, "撤銷失敗"));
    } finally {
      setWorking(false);
    }
  };

  const toggleFlag = async (flag: SystemFeatureFlag) => {
    setWorking(true);
    try {
      await systemApi.setFeatureFlag(flag.key, !flag.enabled);
      toast.success(`${flag.description}：${!flag.enabled ? "已啟用" : "已停用"}`);
      await refresh();
    } catch (error) {
      toast.error(apiErrorMessage(error, "切換失敗"));
    } finally {
      setWorking(false);
    }
  };

  if (!isAdmin) {
    return (
      <section className="p-6 text-sm" role="alert" style={{ color: "var(--danger)" }}>
        需要超級管理員權限才能管理使用者封鎖與全站功能旗標。
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="border-b pb-4" style={{ borderColor: "var(--border)" }}>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>使用者與功能處置</h1>
        <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--text-secondary)" }}>
          管理使用者封鎖、登入工作階段、功能旗標與持續生效的防禦規則。
        </p>
      </header>

      {loadError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm" role="alert" style={{ borderColor: "var(--danger-border)", color: "var(--danger)" }}>
          <span>{loadError}</span>
          <button type="button" onClick={() => void refresh()} className="btn btn-ghost" disabled={loading}>
            <RefreshCcw size={15} aria-hidden /> 重新載入
          </button>
        </div>
      )}

      <section className="space-y-4" aria-labelledby="user-actions-title">
        <div>
          <h2 id="user-actions-title" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>使用者處置</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>可先預覽目標帳號，再執行封鎖或撤銷所有登入工作階段。</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="space-y-3 rounded-md border p-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              <Ban size={16} aria-hidden /> 封鎖使用者
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={blockUserIdentifier}
                onChange={(event) => {
                  setBlockUserIdentifier(event.target.value);
                  setBlockUserPreview(null);
                }}
                placeholder="使用者 UUID 或任一 Email"
                aria-label="要封鎖的使用者 UUID 或 Email"
                className="input min-w-0 flex-1"
              />
              <button type="button" onClick={() => void previewUser()} disabled={!blockUserIdentifier.trim() || previewLoading} className="btn btn-ghost">
                {previewLoading ? "查詢中…" : "預覽使用者"}
              </button>
            </div>
            {blockUserPreview && (
              <dl className="grid gap-x-4 gap-y-1 rounded-md border p-3 text-xs sm:grid-cols-[auto_1fr]" style={{ borderColor: "var(--border)" }}>
                <dt style={{ color: "var(--text-muted)" }}>帳號</dt>
                <dd className="break-all" style={{ color: "var(--text-primary)" }}>{blockUserPreview.display_name} · {blockUserPreview.email}</dd>
                <dt style={{ color: "var(--text-muted)" }}>已使用 Email</dt>
                <dd className="break-all" style={{ color: "var(--text-secondary)" }}>{blockUserPreview.emails.join("、") || "無"}</dd>
                <dt style={{ color: "var(--text-muted)" }}>近 30 天登入 IP</dt>
                <dd className="break-all" style={{ color: "var(--text-secondary)" }}>{blockUserPreview.ips.join("、") || "無紀錄"}</dd>
              </dl>
            )}
            <Field label="封鎖原因（會顯示給使用者）">
              <input value={blockUserReason} onChange={(event) => setBlockUserReason(event.target.value)} placeholder="例如：濫用服務" className="input w-full" />
            </Field>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={blockUserEmails} onChange={(event) => setBlockUserEmails(event.target.checked)} />
                一併封鎖使用過的 Email
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={blockUserIps} onChange={(event) => setBlockUserIps(event.target.checked)} />
                一併封鎖近 30 天登入 IP
              </label>
            </div>
            <button type="button" onClick={() => void blockUser()} disabled={working || !blockUserIdentifier.trim() || !blockUserReason.trim()} className="btn btn-danger">
              <Ban size={15} aria-hidden /> 封鎖並強制登出
            </button>
          </section>

          <section className="space-y-3 rounded-md border p-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              <UserX size={16} aria-hidden /> 強制登出
            </h3>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>撤銷指定使用者的所有登入工作階段，使用者需重新登入。</p>
            <Field label="使用者 UUID">
              <input value={revokeUserId} onChange={(event) => setRevokeUserId(event.target.value)} className="input w-full font-mono" />
            </Field>
            <button type="button" onClick={() => void revokeUser()} disabled={working || !revokeUserId.trim()} className="btn btn-danger">
              <UserX size={15} aria-hidden /> 撤銷所有登入
            </button>
          </section>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="feature-flags-title">
        <div>
          <h2 id="feature-flags-title" className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>功能旗標</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>調整全站功能的啟用狀態。</p>
        </div>
        <div className="divide-y rounded-md border" style={{ borderColor: "var(--border)" }}>
          {flags.length === 0 ? (
            <p className="p-4 text-sm" role={loading ? "status" : undefined} style={{ color: "var(--text-muted)" }}>
              {loading ? "載入功能旗標…" : "目前沒有功能旗標。"}
            </p>
          ) : flags.map((flag) => (
            <div key={flag.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{flag.description}</p>
                <p className="break-all font-mono text-xs" style={{ color: "var(--text-muted)" }}>{flag.key}</p>
              </div>
              <button type="button" onClick={() => void toggleFlag(flag)} disabled={working} aria-pressed={flag.enabled} className={`btn ${flag.enabled ? "btn-secondary" : "btn-ghost"}`}>
                <ShieldCheck size={15} aria-hidden /> {flag.enabled ? "停用" : "啟用"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="defense-rules-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="defense-rules-title" className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              <LockKeyhole size={18} aria-hidden /> 長期防禦規則
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>規則會保留在清單中；可修改目標、原因、到期時間與端點限流參數。</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} className="btn btn-ghost">
            <RefreshCcw size={15} aria-hidden /> 重新整理
          </button>
        </div>

        <div className="space-y-3 rounded-md border p-4" style={{ borderColor: "var(--border)" }}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,0.8fr)_minmax(12rem,1.2fr)_minmax(12rem,1fr)_8rem_auto]">
            <Field label="規則類型">
              <select value={ruleType} onChange={(event) => setRuleType(event.target.value as DefenseRuleType)} className="input w-full">
                {RULE_TYPES.map((type) => <option key={type} value={type}>{RULE_TYPE_LABEL[type]}</option>)}
              </select>
            </Field>
            <Field label="目標">
              <input value={ruleTarget} onChange={(event) => setRuleTarget(event.target.value)} placeholder="IP / CIDR / UUID / Email / 路徑" className="input w-full font-mono" />
            </Field>
            <Field label="原因">
              <input value={ruleReason} onChange={(event) => setRuleReason(event.target.value)} className="input w-full" />
            </Field>
            <Field label="有效分鐘數（0 為永久）">
              <input type="number" min={0} value={ruleTtlMinutes} onChange={(event) => setRuleTtlMinutes(Number(event.target.value))} className="input w-full" />
            </Field>
            <button type="button" onClick={() => void createRule()} disabled={working || !ruleTarget.trim()} className="btn btn-danger self-end">
              <Plus size={15} aria-hidden /> 建立規則
            </button>
          </div>
          {ruleType === "rate_limit_override" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="端點請求數">
                <input type="number" min={1} value={ruleConfigRequests} onChange={(event) => setRuleConfigRequests(Number(event.target.value))} className="input w-full" />
              </Field>
              <Field label="端點視窗秒數">
                <input type="number" min={1} value={ruleConfigWindowSeconds} onChange={(event) => setRuleConfigWindowSeconds(Number(event.target.value))} className="input w-full" />
              </Field>
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
          {rules.length === 0 ? (
            <p className="p-5 text-center text-sm" role={loading ? "status" : undefined} style={{ color: "var(--text-muted)" }}>
              {loading ? "載入防禦規則…" : "目前沒有防禦規則。"}
            </p>
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead style={{ color: "var(--text-muted)" }}>
                <tr className="border-b text-left text-xs" style={{ borderColor: "var(--border)" }}>
                  <th scope="col" className="px-3 py-2 font-medium">狀態</th>
                  <th scope="col" className="px-3 py-2 font-medium">類型</th>
                  <th scope="col" className="px-3 py-2 font-medium">目標</th>
                  <th scope="col" className="px-3 py-2 font-medium">原因</th>
                  <th scope="col" className="px-3 py-2 font-medium">到期</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <FragmentRow
                    key={rule.id}
                    rule={rule}
                    editing={editingRuleId === rule.id}
                    working={working}
                    editingRuleType={editingRuleType}
                    editingRuleTarget={editingRuleTarget}
                    editingRuleReason={editingRuleReason}
                    editingRuleExpiresAt={editingRuleExpiresAt}
                    editingRuleRequests={editingRuleRequests}
                    editingRuleWindowSeconds={editingRuleWindowSeconds}
                    onStartEdit={() => startEditingRule(rule)}
                    onToggleActive={() => void setRuleActive(rule, !rule.is_active)}
                    onTypeChange={setEditingRuleType}
                    onTargetChange={setEditingRuleTarget}
                    onReasonChange={setEditingRuleReason}
                    onExpiresChange={setEditingRuleExpiresAt}
                    onRequestsChange={setEditingRuleRequests}
                    onWindowChange={setEditingRuleWindowSeconds}
                    onSave={() => void saveRule()}
                    onCancel={() => setEditingRuleId(null)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function FragmentRow({
  rule,
  editing,
  working,
  editingRuleType,
  editingRuleTarget,
  editingRuleReason,
  editingRuleExpiresAt,
  editingRuleRequests,
  editingRuleWindowSeconds,
  onStartEdit,
  onToggleActive,
  onTypeChange,
  onTargetChange,
  onReasonChange,
  onExpiresChange,
  onRequestsChange,
  onWindowChange,
  onSave,
  onCancel,
}: {
  rule: DefenseRule;
  editing: boolean;
  working: boolean;
  editingRuleType: DefenseRuleType;
  editingRuleTarget: string;
  editingRuleReason: string;
  editingRuleExpiresAt: string;
  editingRuleRequests: number;
  editingRuleWindowSeconds: number;
  onStartEdit: () => void;
  onToggleActive: () => void;
  onTypeChange: (value: DefenseRuleType) => void;
  onTargetChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onExpiresChange: (value: string) => void;
  onRequestsChange: (value: number) => void;
  onWindowChange: (value: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <tr className="border-b align-top last:border-0" style={{ borderColor: "var(--border)" }}>
        <td className="px-3 py-2"><StatusLabel active={rule.is_active} /></td>
        <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>{RULE_TYPE_LABEL[rule.rule_type]}</td>
        <td className="max-w-64 break-all px-3 py-2 font-mono text-xs" style={{ color: "var(--text-primary)" }}>{rule.target}</td>
        <td className="max-w-64 px-3 py-2" style={{ color: "var(--text-secondary)" }} title={rule.reason}>{rule.reason || "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>{expirationLabel(rule.expires_at)}</td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={onStartEdit} disabled={working} className="btn-sm btn-ghost">
              <Pencil size={13} aria-hidden /> 編輯
            </button>
            <button type="button" onClick={onToggleActive} disabled={working} className={`btn-sm ${rule.is_active ? "btn-danger-ghost" : "btn-secondary"}`}>
              {rule.is_active ? "停用" : "啟用"}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="border-b" style={{ borderColor: "var(--border)", background: "var(--bg-hover)" }}>
          <td colSpan={6} className="p-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="規則類型">
                <select value={editingRuleType} onChange={(event) => onTypeChange(event.target.value as DefenseRuleType)} className="input w-full">
                  {RULE_TYPES.map((type) => <option key={type} value={type}>{RULE_TYPE_LABEL[type]}</option>)}
                </select>
              </Field>
              <Field label="目標">
                <input value={editingRuleTarget} onChange={(event) => onTargetChange(event.target.value)} className="input w-full font-mono" />
              </Field>
              <Field label="原因">
                <input value={editingRuleReason} onChange={(event) => onReasonChange(event.target.value)} className="input w-full" />
              </Field>
              <Field label="到期時間">
                <input type="datetime-local" value={editingRuleExpiresAt} onChange={(event) => onExpiresChange(event.target.value)} className="input w-full" />
              </Field>
            </div>
            {editingRuleType === "rate_limit_override" && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="端點請求數">
                  <input type="number" min={1} value={editingRuleRequests} onChange={(event) => onRequestsChange(Number(event.target.value))} className="input w-full" />
                </Field>
                <Field label="端點視窗秒數">
                  <input type="number" min={1} value={editingRuleWindowSeconds} onChange={(event) => onWindowChange(Number(event.target.value))} className="input w-full" />
                </Field>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={onSave} disabled={working || !editingRuleTarget.trim()} className="btn btn-primary">
                <Save size={14} aria-hidden /> 儲存規則
              </button>
              <button type="button" onClick={onCancel} disabled={working} className="btn btn-ghost">取消</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
