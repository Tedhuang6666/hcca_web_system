"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { usersApi, classApi, lineApi, discordApi, apiErrorMessage } from "@/lib/api";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import { SectionSkeleton } from "@/components/ui/Skeleton";
import type {
  DiscordBindingOut,
  LineBindingOut,
  LineLinkCodeOut,
  UserRead,
  UserPositionRead,
  SchoolClassListItem,
} from "@/lib/types";

const POSITION_CATEGORY_LABEL = {
  council: "自治職位",
  class: "班級職位",
  system: "系統職位",
} as const;

type ProfileTab = "account" | "connections" | "positions" | "permissions";

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: "account", label: "帳號" },
  { key: "connections", label: "連結" },
  { key: "positions", label: "職位" },
  { key: "permissions", label: "權限" },
];

/* ─── Inline edit field ─────────────────────────────────────────────────────── */
function EditableField({
  label,
  value,
  placeholder,
  maxLength,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  // sync when value changes from outside
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  async function handleSave() {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            maxLength={maxLength}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
          />
          <button onClick={handleSave} disabled={saving} className="btn btn-primary text-xs px-3 py-1.5"
            style={{ minHeight: "auto" }}>
            {saving ? "…" : "儲存"}
          </button>
          <button onClick={() => setEditing(false)} className="btn btn-ghost text-xs px-3 py-1.5"
            style={{ minHeight: "auto" }}>
            取消
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 group">
          <p className="text-sm flex-1" style={{ color: value ? "var(--text-primary)" : "var(--text-disabled)" }}>
            {value || placeholder || "—"}
          </p>
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className="text-xs opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded"
            style={{ color: "var(--primary)" }}>
            編輯
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export default function ProfilePage() {
  const { isModuleClosed } = useModuleStatus();
  const [activeTab, setActiveTab] = useState<ProfileTab>("account");
  const [user, setUser] = useState<UserRead | null>(null);
  const [positions, setPositions] = useState<UserPositionRead[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [myClass, setMyClass] = useState<SchoolClassListItem | null>(null);
  const [lineBinding, setLineBinding] = useState<LineBindingOut | null>(null);
  const [discordBinding, setDiscordBinding] = useState<DiscordBindingOut | null>(null);
  const [lineCode, setLineCode] = useState<LineLinkCodeOut | null>(null);
  const [lineBusy, setLineBusy] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [linkedEmails, setLinkedEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailVerificationPending, setEmailVerificationPending] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    Promise.all([
      usersApi.me().catch((e) => {
        setLoadError(apiErrorMessage(e, "無法載入個人資料"));
        return null;
      }),
      usersApi.myPositions(false).catch(() => []),
      usersApi.myEmails().catch(() => ({ emails: [] })),
    ]).then(([u, pos, emailResult]) => {
      if (u) setUser(u);
      setPositions(pos as UserPositionRead[]);
      setLinkedEmails(emailResult.emails);
    }).finally(() => setLoading(false));

    classApi.myClass().then(setMyClass).catch(() => setMyClass(null));
    lineApi.me().then(setLineBinding).catch(() => setLineBinding({ linked: false, line_display_name: null, linked_at: null }));
    discordApi.me().then(setDiscordBinding).catch(() => setDiscordBinding({
      linked: false,
      discord_user_id: null,
      username: null,
      global_name: null,
      linked_at: null,
    }));

    // 從 sessionStorage 讀取有效權限（敏感欄位已移至 sessionStorage）
    try {
      const raw = sessionStorage.getItem("permissions");
      if (raw) setPermissions(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  async function saveDisplayName(v: string) {
    if (!v.trim()) { toast.error("名稱不可為空"); return; }
    try {
      const updated = await usersApi.updateMe({ display_name: v.trim() });
      setUser(updated);
      localStorage.setItem("user_name", updated.display_name);
      toast.success("顯示名稱已更新");
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
      throw e;
    }
  }

  async function saveStudentId(v: string) {
    try {
      const updated = await usersApi.updateMe({ student_id: v.trim() || undefined });
      setUser(updated);
      toast.success("學號已更新");
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
      throw e;
    }
  }

  async function toggleShowEmail() {
    if (!user) return;
    try {
      const updated = await usersApi.updateMe({ show_email: !user.show_email });
      setUser(updated);
    } catch { /* ignore */ }
  }

  async function requestEmailVerification() {
    if (!newEmail.trim()) {
      toast.error("請輸入要連結的 Email");
      return;
    }
    setEmailBusy(true);
    try {
      await usersApi.requestEmailVerification(newEmail.trim());
      setEmailVerificationPending(true);
      toast.success("驗證碼已寄出，10 分鐘內有效");
    } catch (e) {
      toast.error(apiErrorMessage(e, "寄送驗證碼失敗"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function verifyEmail() {
    if (!/^\d{6}$/.test(emailCode)) {
      toast.error("請輸入 6 位數驗證碼");
      return;
    }
    setEmailBusy(true);
    try {
      const result = await usersApi.verifyEmail(newEmail.trim(), emailCode);
      setLinkedEmails(result.emails);
      setNewEmail("");
      setEmailCode("");
      setEmailVerificationPending(false);
      toast.success("登入 Email 已連結");
    } catch (e) {
      toast.error(apiErrorMessage(e, "驗證失敗"));
    } finally {
      setEmailBusy(false);
    }
  }

  async function createLineCode() {
    setLineBusy(true);
    try {
      const code = await lineApi.createLinkCode();
      setLineCode(code);
      toast.success("LINE 綁定碼已產生");
    } catch (e) {
      toast.error(apiErrorMessage(e, "產生綁定碼失敗"));
    } finally {
      setLineBusy(false);
    }
  }

  async function unlinkLine() {
    setLineBusy(true);
    try {
      await lineApi.unlink();
      setLineBinding({ linked: false, line_display_name: null, linked_at: null });
      setLineCode(null);
      toast.success("已解除 LINE 綁定");
    } catch (e) {
      toast.error(apiErrorMessage(e, "解除綁定失敗"));
    } finally {
      setLineBusy(false);
    }
  }

  function linkDiscord() {
    window.location.href = discordApi.loginUrl("/profile");
  }

  async function unlinkDiscord() {
    setDiscordBusy(true);
    try {
      await discordApi.unlink();
      setDiscordBinding({
        linked: false,
        discord_user_id: null,
        username: null,
        global_name: null,
        linked_at: null,
      });
      toast.success("已解除 Discord 綁定");
    } catch (e) {
      toast.error(apiErrorMessage(e, "解除綁定失敗"));
    } finally {
      setDiscordBusy(false);
    }
  }

  const initials = user?.display_name?.charAt(0)?.toUpperCase() ?? "?";

  const today = new Date().toISOString().slice(0, 10);
  const activePositions = positions.filter(
    p => p.start_date <= today && (!p.end_date || p.end_date >= today)
  );
  const activeCouncilPositions = activePositions.filter((p) => p.position_category === "council");
  const activeClassPositions = activePositions.filter((p) => p.position_category === "class");
  const activeSystemPositions = activePositions.filter((p) => p.position_category === "system");
  const pastPositions = positions.filter(
    p => p.end_date && p.end_date < today
  );

  if (loading) {
    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>個人資料</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>管理您的帳號資訊與職位記錄</p>
        </div>
        <div
          className="flex gap-1 rounded-lg border p-1"
          style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
          aria-hidden="true">
          {PROFILE_TABS.map((tab) => (
            <span
              key={tab.key}
              className="flex-1 rounded-md px-3 py-2 text-center text-xs font-medium"
              style={{
                background: tab.key === "account" ? "var(--primary-dim)" : "transparent",
                color: tab.key === "account" ? "var(--primary)" : "var(--text-muted)",
              }}>
              {tab.label}
            </span>
          ))}
        </div>
        <SectionSkeleton lines={6} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>個人資料</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>管理您的帳號資訊與職位記錄</p>
        </div>
        <section className="card p-6 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            個人資料載入失敗
          </p>
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {loadError || "目前無法取得帳號資料，請稍後再試。"}
          </p>
          <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
            重新載入
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* 頁首 */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>個人資料</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>管理您的帳號資訊與職位記錄</p>
      </div>

      <div
        className="flex gap-1 rounded-lg border p-1"
        style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
        role="tablist"
        aria-label="個人資料頁籤">
        {PROFILE_TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              className="flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors"
              style={{
                background: active ? "var(--primary-dim)" : "transparent",
                color: active ? "var(--primary)" : "var(--text-muted)",
              }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 帳號資訊卡片 */}
      {activeTab === "account" && <section className="card p-6 space-y-5" aria-labelledby="profile-heading">
        <div className="flex items-center gap-4">
          {/* 頭像 */}
          {user?.avatar_url ? (
            <Image src={user.avatar_url} alt={user.display_name}
              width={56} height={56} unoptimized
              className="w-14 h-14 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
              style={{ background: "var(--primary-dim)", color: "var(--primary)" }}
              aria-hidden="true">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <h2 id="profile-heading" className="text-base font-semibold truncate"
              style={{ color: "var(--text-primary)" }}>
              {user?.display_name ?? "—"}
            </h2>
            <p className="text-sm truncate" style={{ color: "var(--text-muted)" }}>
              {user?.email ?? "—"}
            </p>
            {user?.is_superuser && (
              <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded font-medium"
                style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24" }}>
                管理員
              </span>
            )}
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}
          className="space-y-4">
          <EditableField
            label="顯示名稱"
            value={user?.display_name ?? ""}
            placeholder="請輸入顯示名稱"
            maxLength={100}
            onSave={saveDisplayName}
          />
          <EditableField
            label="學號"
            value={user?.student_id ?? ""}
            placeholder="尚未設定"
            maxLength={20}
            onSave={saveStudentId}
          />
          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>目前班級</p>
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              {myClass
                ? (myClass.label ?? `${myClass.academic_year} 學年度 ${myClass.class_code} 班`)
                : "尚未歸班（由管理員依學號區間設定）"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>電子郵件</p>
            <div className="space-y-1">
              {(linkedEmails.length > 0 ? linkedEmails : [user?.email ?? "—"]).map((email) => (
                <p key={email} className="text-sm break-all" style={{ color: "var(--text-primary)" }}>
                  {email}
                  {email === user?.email && (
                    <span className="ml-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                      主要
                    </span>
                  )}
                </p>
              ))}
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(event) => {
                    setNewEmail(event.target.value);
                    setEmailVerificationPending(false);
                    setEmailCode("");
                  }}
                  placeholder="新增私人或其他校務 Email"
                  className="input flex-1"
                />
                <button
                  onClick={requestEmailVerification}
                  disabled={emailBusy || !newEmail.trim()}
                  className="btn btn-primary text-xs"
                >
                  寄送驗證碼
                </button>
              </div>
              {emailVerificationPending && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    inputMode="numeric"
                    value={emailCode}
                    onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6 位數驗證碼"
                    className="input flex-1 font-mono"
                  />
                  <button
                    onClick={verifyEmail}
                    disabled={emailBusy || emailCode.length !== 6}
                    className="btn btn-primary text-xs"
                  >
                    驗證並連結
                  </button>
                </div>
              )}
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                新 Email 驗證成功後，可使用該 Google 帳號登入同一個平台帳戶。
              </p>
            </div>
          </div>

          {/* 公文承辦人顯示設定 */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
              公文承辦人資訊顯示設定
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              建立公文時，電子郵件可自動帶入承辦人欄位，並選擇是否顯示於公文上。
            </p>
            <div className="space-y-2">
              {[
                {
                  label: "在公文上顯示電子郵件",
                  checked: user?.show_email ?? true,
                  onToggle: toggleShowEmail,
                },
              ].map(({ label, checked, onToggle }) => (
                <label key={label} className="flex items-center gap-3 cursor-pointer">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={label}
                    onClick={onToggle}
                    className="inline-flex h-5 w-10 flex-shrink-0 items-center rounded-full p-0.5 transition-colors"
                    style={{
                      background: checked ? "var(--primary)" : "var(--border-strong)",
                    }}>
                    <span
                      className="block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                      style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
                    />
                  </button>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>帳號狀態</p>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full`}
                style={{ background: user?.is_active ? "var(--success)" : "var(--danger)" }}
                aria-hidden="true" />
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                {user?.is_active ? "正常" : "已停用"}
              </span>
              {user?.is_verified && (
                <span className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "var(--success-dim)", color: "var(--success)" }}>
                  已驗證
                </span>
              )}
            </div>
          </div>
        </div>
      </section>}

      {activeTab === "connections" && !isModuleClosed("line") && <section className="card p-5 space-y-4" aria-labelledby="line-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="line-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              LINE Bot
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              綁定後可在 LINE 查詢待辦、公告、學餐並接收通知。
            </p>
          </div>
          {lineBinding?.linked ? (
            <button className="btn btn-ghost btn-sm" onClick={unlinkLine} disabled={lineBusy}>
              解除綁定
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={createLineCode} disabled={lineBusy}>
              產生綁定碼
            </button>
          )}
        </div>
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {lineBinding?.linked ? "已綁定 LINE" : "尚未綁定 LINE"}
          </p>
          {lineBinding?.linked_at && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              綁定時間：{new Date(lineBinding.linked_at).toLocaleString()}
            </p>
          )}
          {lineCode && !lineBinding?.linked && (
            <div className="mt-3">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                請在 LINE Bot 輸入
              </p>
              <p className="mt-1 font-mono text-lg font-semibold" style={{ color: "var(--primary)" }}>
                綁定 {lineCode.code}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                有效至 {new Date(lineCode.expires_at).toLocaleTimeString()}
              </p>
            </div>
          )}
        </div>
      </section>}

      {activeTab === "connections" && !isModuleClosed("discord") && <section className="card p-5 space-y-4" aria-labelledby="discord-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="discord-heading" className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Discord Bot
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              綁定後可在 Discord 使用待辦、陳情、公文審核與辦公通知。
            </p>
          </div>
          {discordBinding?.linked ? (
            <button className="btn btn-ghost btn-sm" onClick={unlinkDiscord} disabled={discordBusy}>
              解除綁定
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={linkDiscord} disabled={discordBusy}>
              連結 Discord
            </button>
          )}
        </div>
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {discordBinding?.linked
              ? `已綁定 ${discordBinding.global_name || discordBinding.username || "Discord 帳號"}`
              : "尚未綁定 Discord"}
          </p>
          {discordBinding?.linked_at && (
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              綁定時間：{new Date(discordBinding.linked_at).toLocaleString()}
            </p>
          )}
        </div>
      </section>}
      {activeTab === "connections" && isModuleClosed("line") && isModuleClosed("discord") && (
        <section className="card p-6 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            目前沒有可用的外部帳號連結服務。
          </p>
        </section>
      )}

      {/* 現職職位 */}
      {activeTab === "positions" && <section className="card overflow-hidden" aria-labelledby="positions-heading">
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 id="positions-heading" className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}>
            現職職位
            {activePositions.length > 0 && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                {activePositions.length}
              </span>
            )}
          </h2>
        </div>
        {activePositions.length === 0 ? (
          <p className="px-5 py-8 text-sm text-center" style={{ color: "var(--text-muted)" }}>
            目前無在任職位
          </p>
        ) : (
          <div>
            {[
              ["自治職位", activeCouncilPositions],
              ["班級職位", activeClassPositions],
              ["系統職位", activeSystemPositions],
            ].filter(([, list]) => (list as UserPositionRead[]).length > 0).map(([label, list]) => (
              <div key={label as string}>
                <p className="px-5 pt-4 pb-2 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                  {label as string}
                </p>
                <ul aria-label={`${label as string}列表`}>
                  {(list as UserPositionRead[]).map((p, idx) => (
                    <li key={p.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-3"
                      style={idx < (list as UserPositionRead[]).length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {p.position_name || p.position_id.slice(0, 8) + "…"}
                        </p>
                        {p.position_org_name && (
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {p.position_org_name}
                          </p>
                        )}
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          自 {p.start_date}{p.end_date ? ` 至 ${p.end_date}` : " 起（無限期）"}
                        </p>
                      </div>
                      <span className="badge" style={{ color: "var(--success)", background: "var(--success-dim)", borderColor: "var(--success)" }}>
                        在任中
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>}

      {/* 有效權限 */}
      {activeTab === "permissions" && permissions.length > 0 && (
        <section className="card p-5" aria-labelledby="perms-heading">
          <h2 id="perms-heading" className="text-sm font-semibold mb-3"
            style={{ color: "var(--text-primary)" }}>
            有效權限
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {permissions.map(code => (
              <span key={code} className="text-xs px-2 py-1 rounded font-mono"
                style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                {code}
              </span>
            ))}
          </div>
        </section>
      )}
      {activeTab === "permissions" && permissions.length === 0 && (
        <section className="card p-6 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            目前沒有可顯示的有效權限。
          </p>
        </section>
      )}

      {/* 歷史職位（折疊） */}
      {activeTab === "positions" && pastPositions.length > 0 && (
        <section className="card overflow-hidden" aria-labelledby="past-positions-heading">
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 id="past-positions-heading" className="text-sm font-semibold"
              style={{ color: "var(--text-muted)" }}>
              歷史職位（{pastPositions.length} 筆）
            </h2>
          </div>
          <ul aria-label="歷史職位列表">
            {pastPositions.map((p, idx) => (
              <li key={p.id}
                className="px-5 py-3 flex items-center justify-between gap-3"
                style={idx < pastPositions.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    {p.position_name || p.position_id.slice(0, 8) + "…"}
                  </p>
                  {p.position_org_name && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{p.position_org_name}</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {POSITION_CATEGORY_LABEL[p.position_category]} · {p.start_date} 至 {p.end_date}
                  </p>
                </div>
                <span className="badge" style={{ color: "var(--text-muted)", background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
                  已卸任
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
