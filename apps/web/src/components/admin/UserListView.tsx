"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { adminApi, ApiError } from "@/lib/api";
import type { AdminUserDetail, PermissionCodeInfo, PositionSummary } from "@/lib/types";

// ── 使用者列表視圖 ────────────────────────────────────────────────────────────
export default function UserListView({
  users, positions, permCodes, onUpdated, onPreRegister,
}: {
  users: AdminUserDetail[];
  positions: PositionSummary[];
  permCodes: PermissionCodeInfo[];
  onUpdated: () => void;
  onPreRegister: () => void;
}) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignPos, setAssignPos] = useState<Record<string, string>>({});
  const [assignStart, setAssignStart] = useState<Record<string, string>>({});
  const [assignEnd, setAssignEnd] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(u =>
      u.display_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.student_id ?? "").includes(q),
    );
  }, [users, search]);

  const addPosition = async (userId: string) => {
    const posId = assignPos[userId];
    if (!posId) return;
    setAssigning(userId);
    try {
      await adminApi.addUserPosition(userId, {
        position_id: posId,
        start_date: assignStart[userId] || new Date().toISOString().split("T")[0],
        end_date: assignEnd[userId] || null,
      });
      toast.success("職位已指派");
      setAssignPos(p => ({ ...p, [userId]: "" }));
      onUpdated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "指派失敗"); }
    finally { setAssigning(null); }
  };

  const removePos = async (userId: string, userPositionId: string) => {
    try {
      await adminApi.removeUserPosition(userId, userPositionId);
      toast.success("職位已移除");
      onUpdated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "移除失敗"); }
  };

  const toggleActive = async (u: AdminUserDetail) => {
    if (!confirm(`確定要${u.is_active ? "停用" : "啟用"}帳號「${u.display_name}」？`)) return;
    try {
      await adminApi.updateUser(u.id, { is_active: !u.is_active });
      toast.success(u.is_active ? "帳號已停用" : "帳號已啟用");
      onUpdated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
  };

  const toggleSuperuser = async (u: AdminUserDetail) => {
    const action = u.is_superuser ? "取消超管權限" : "賦予超管權限";
    const confirm1 = confirm(`確定要${action}「${u.display_name}」？\n超管可存取所有功能，請謹慎操作。`);
    if (!confirm1) return;
    try {
      await adminApi.updateUser(u.id, { is_superuser: !u.is_superuser });
      toast.success(`已${action}`);
      onUpdated();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : "操作失敗"); }
  };

  return (
    <div className="h-full flex flex-col">
      {/* 搜尋列 */}
      <div className="flex gap-3 p-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" width="14" height="14"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋姓名、Email 或學號..."
            className="w-full bg-transparent text-sm pl-9 pr-3 py-2 rounded-xl outline-none"
            style={{ border: "1px solid var(--border)" }}
          />
        </div>
        <button onClick={onPreRegister}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all hover:opacity-90"
          style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          預先建立帳號
        </button>
      </div>

      {/* 使用者列表 */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>找不到符合的帳號</div>
        ) : (
          <ul>
            {filtered.map((u, idx) => {
              const isExpanded = expandedId === u.id;
              const today = new Date().toISOString().split("T")[0];
              return (
                <li key={u.id} style={idx < filtered.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                  {/* 主列 */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* 頭像 */}
                    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                      style={{ background: u.is_active ? "var(--primary-dim)" : "var(--bg-elevated)", color: u.is_active ? "var(--primary)" : "var(--text-muted)" }}>
                      {u.display_name.charAt(0)}
                    </div>

                    {/* 資訊 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{u.display_name}</span>
                        {u.is_superuser && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: "#fbbf24", background: "rgba(251,191,36,0.12)" }}>超管</span>
                        )}
                        {!u.is_active && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>停用</span>
                        )}
                      </div>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        {u.email}
                        {u.student_id && <span className="ml-2 opacity-70">#{u.student_id}</span>}
                      </p>
                      {/* 職位標籤 */}
                      {u.positions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {u.positions.map(p => (
                            <span key={p.user_position_id ?? p.id}
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 動作 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => toggleActive(u)}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                        style={{ border: "1px solid var(--border)", color: u.is_active ? "#f87171" : "var(--primary)" }}>
                        {u.is_active ? "停用" : "啟用"}
                      </button>
                      <button onClick={() => toggleSuperuser(u)}
                        className="text-xs px-2.5 py-1 rounded-lg transition-colors"
                        style={{ border: "1px solid var(--border)", color: u.is_superuser ? "#f87171" : "#fbbf24" }}>
                        {u.is_superuser ? "取消超管" : "設超管"}
                      </button>
                      <button onClick={() => setExpandedId(isExpanded ? null : u.id)}
                        className="text-xs px-2.5 py-1 rounded-lg"
                        style={{ border: "1px solid var(--border)", color: "var(--primary)" }}>
                        {isExpanded ? "收起" : "詳情"}
                      </button>
                    </div>
                  </div>

                  {/* 展開詳情 */}
                  {isExpanded && (
                    <div className="mx-4 mb-3 p-4 rounded-xl space-y-4"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>

                      {/* 目前職位（可移除） */}
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>目前職位</p>
                        {u.positions.length === 0
                          ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>無職位</p>
                          : <div className="flex flex-wrap gap-1.5">
                              {u.positions.map(p => (
                                <span key={p.user_position_id ?? p.id}
                                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                                  style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)", color: "var(--primary)" }}>
                                  {p.org_name} · {p.name}
                                  {p.user_position_id && (
                                    <button onClick={() => removePos(u.id, p.user_position_id!)}
                                      className="ml-1 hover:text-red-400 transition-colors"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                  )}
                                </span>
                              ))}
                            </div>
                        }
                      </div>

                      {/* 指派新職位 */}
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>指派職位</p>
                        <div className="grid grid-cols-3 gap-2 items-end">
                          <div className="col-span-3 sm:col-span-1">
                            <select value={assignPos[u.id] ?? ""} onChange={e => setAssignPos(p => ({ ...p, [u.id]: e.target.value }))}
                              className="w-full text-xs rounded-lg px-2 py-1.5 outline-none"
                              style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                              <option value="">選擇職位...</option>
                              {positions.filter(p => !u.positions.some(up => up.id === p.id)).map(p => (
                                <option key={p.id} value={p.id}>{p.org_name} / {p.name}</option>
                              ))}
                            </select>
                          </div>
                          <input type="date"
                            value={assignStart[u.id] ?? today}
                            onChange={e => setAssignStart(p => ({ ...p, [u.id]: e.target.value }))}
                            className="text-xs rounded-lg px-2 py-1.5 bg-transparent outline-none"
                            style={{ border: "1px solid var(--border)", colorScheme: "dark" }} />
                          <input type="date" placeholder="結束（留空=無限）"
                            value={assignEnd[u.id] ?? ""}
                            onChange={e => setAssignEnd(p => ({ ...p, [u.id]: e.target.value }))}
                            className="text-xs rounded-lg px-2 py-1.5 bg-transparent outline-none"
                            style={{ border: "1px solid var(--border)", colorScheme: "dark" }} />
                        </div>
                        <button onClick={() => addPosition(u.id)}
                          disabled={!assignPos[u.id] || assigning === u.id}
                          className="mt-2 text-xs px-4 py-1.5 rounded-lg font-medium disabled:opacity-40 transition-all"
                          style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                          {assigning === u.id ? "指派中..." : "＋ 指派"}
                        </button>
                      </div>

                      {/* 有效權限 */}
                      <div>
                        <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                          有效權限
                          {u.is_superuser && <span className="ml-2 text-[10px] font-normal" style={{ color: "#fbbf24" }}>（超管自動通過）</span>}
                        </p>
                        {u.is_superuser ? (
                          <p className="text-xs" style={{ color: "#fbbf24" }}>超管：所有操作均允許</p>
                        ) : u.effective_permissions.length === 0 ? (
                          <p className="text-xs" style={{ color: "var(--text-muted)" }}>無任何有效權限</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {u.effective_permissions.map(code => {
                              const info = permCodes.find(p => p.code === code);
                              return (
                                <span key={code} title={info?.desc}
                                  className="text-xs px-2 py-0.5 rounded"
                                  style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                                  {info?.label ?? code}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
