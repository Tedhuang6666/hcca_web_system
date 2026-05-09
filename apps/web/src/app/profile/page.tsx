"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { usersApi, ApiError } from "@/lib/api";
import type { UserRead, UserPositionRead } from "@/lib/types";

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
  const [user, setUser] = useState<UserRead | null>(null);
  const [positions, setPositions] = useState<UserPositionRead[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      usersApi.me().catch(() => null),
      usersApi.myPositions(false).catch(() => []),
    ]).then(([u, pos]) => {
      if (u) setUser(u);
      setPositions(pos as UserPositionRead[]);
    }).finally(() => setLoading(false));

    // 從 localStorage 讀取有效權限
    try {
      const raw = localStorage.getItem("permissions");
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
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
      throw e;
    }
  }

  async function saveStudentId(v: string) {
    try {
      const updated = await usersApi.updateMe({ student_id: v.trim() || undefined });
      setUser(updated);
      toast.success("學號已更新");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
      throw e;
    }
  }

  async function savePhone(v: string) {
    try {
      const updated = await usersApi.updateMe({ phone: v.trim() || null });
      setUser(updated);
      toast.success("聯絡電話已更新");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "更新失敗");
      throw e;
    }
  }

  async function toggleShowPhone() {
    if (!user) return;
    try {
      const updated = await usersApi.updateMe({ show_phone: !user.show_phone });
      setUser(updated);
    } catch { /* ignore */ }
  }

  async function toggleShowEmail() {
    if (!user) return;
    try {
      const updated = await usersApi.updateMe({ show_email: !user.show_email });
      setUser(updated);
    } catch { /* ignore */ }
  }

  const initials = user?.display_name?.charAt(0)?.toUpperCase() ?? "?";

  const today = new Date().toISOString().slice(0, 10);
  const activePositions = positions.filter(
    p => p.start_date <= today && (!p.end_date || p.end_date >= today)
  );
  const pastPositions = positions.filter(
    p => p.end_date && p.end_date < today
  );

  if (loading) {
    return (
      <div className="py-24 text-center" style={{ color: "var(--text-muted)" }}>
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
          style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--primary)" }}
          role="status" aria-label="載入中" />
        <p className="text-sm">載入中…</p>
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

      {/* 帳號資訊卡片 */}
      <section className="card p-6 space-y-5" aria-labelledby="profile-heading">
        <div className="flex items-center gap-4">
          {/* 頭像 */}
          {user?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt={user.display_name}
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
          <EditableField
            label="聯絡電話"
            value={user?.phone ?? ""}
            placeholder="尚未設定"
            maxLength={30}
            onSave={savePhone}
          />
          <div>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>電子郵件</p>
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>{user?.email ?? "—"}</p>
          </div>

          {/* 公文承辦人顯示設定 */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
              公文承辦人資訊顯示設定
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              建立公文時，以下資訊可自動帶入承辦人欄位，並選擇是否顯示於公文上。
            </p>
            <div className="space-y-2">
              {[
                {
                  label: "在公文上顯示聯絡電話",
                  checked: user?.show_phone ?? true,
                  onToggle: toggleShowPhone,
                },
                {
                  label: "在公文上顯示電子郵件",
                  checked: user?.show_email ?? true,
                  onToggle: toggleShowEmail,
                },
              ].map(({ label, checked, onToggle }) => (
                <label key={label} className="flex items-center gap-3 cursor-pointer">
                  <button
                    role="switch"
                    aria-checked={checked}
                    onClick={onToggle}
                    className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                    style={{
                      background: checked ? "var(--primary)" : "var(--border-strong)",
                    }}>
                    <span
                      className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                      style={{ transform: checked ? "translateX(20px)" : "translateX(2px)" }}
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
      </section>

      {/* 現職職位 */}
      <section className="card overflow-hidden" aria-labelledby="positions-heading">
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
          <ul aria-label="在任職位列表">
            {activePositions.map((p, idx) => (
              <li key={p.id}
                className="px-5 py-3.5 flex items-center justify-between gap-3"
                style={idx < activePositions.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
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
        )}
      </section>

      {/* 有效權限 */}
      {permissions.length > 0 && (
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

      {/* 歷史職位（折疊） */}
      {pastPositions.length > 0 && (
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
                    {p.start_date} 至 {p.end_date}
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
