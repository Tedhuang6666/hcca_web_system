"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PermCheckboxes } from "@/components/admin/PermissionCatalog";
import { adminApi, apiErrorMessage } from "@/lib/api";
import type { AdminUserDetail, PermissionCodeInfo, PositionSummary } from "@/lib/types";

// ── 職位詳情視圖 ──────────────────────────────────────────────────────────────
export default function PositionView({
  positionId, allPositions, users, permCodes, onUpdated,
}: {
  positionId: string;
  allPositions: PositionSummary[];
  users: AdminUserDetail[];
  permCodes: PermissionCodeInfo[];
  onUpdated: () => void;
}) {
  const pos = allPositions.find(p => p.id === positionId);
  const [editingPerms, setEditingPerms] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingHierarchy, setEditingHierarchy] = useState(false);
  const [hierarchyMode, setHierarchyMode] = useState<"none" | "parent" | "sibling">("none");
  const [hierarchyTargetId, setHierarchyTargetId] = useState("");
  const [savingHierarchy, setSavingHierarchy] = useState(false);
  // 新增成員
  const [addingMember, setAddingMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberStart, setMemberStart] = useState(new Date().toISOString().split("T")[0]);
  const [memberEnd, setMemberEnd] = useState("");
  const [addingMemberLoading, setAddingMemberLoading] = useState(false);

  useEffect(() => {
    if (pos) setSelectedCodes(pos.permission_codes);
  }, [pos]);

  // 此職位的成員
  const members = useMemo(() =>
    users.filter(u => u.positions.some(p => p.id === positionId)),
  [users, positionId]);
  const orgPositions = useMemo(
    () => allPositions.filter(p => p.org_id === pos?.org_id && p.id !== positionId),
    [allPositions, pos, positionId],
  );
  const parentName = useMemo(
    () => allPositions.find(p => p.id === pos?.parent_id)?.name ?? "無上級（頂層/平級）",
    [allPositions, pos?.parent_id],
  );

  const filteredCandidates = useMemo(() =>
    users.filter(u =>
      !members.some(m => m.id === u.id) &&
      (u.display_name.includes(memberSearch) || u.email.includes(memberSearch)),
    ),
  [users, members, memberSearch]);

  if (!pos) return <div className="py-20 text-center text-sm" style={{ color: "var(--text-muted)" }}>找不到此職位</div>;

  const savePerms = async () => {
    setSaving(true);
    try {
      await adminApi.replacePositionPermissions(positionId, selectedCodes);
      toast.success("權限已更新");
      setEditingPerms(false);
      onUpdated();
    } catch (e) { toast.error(apiErrorMessage(e, "更新失敗")); }
    finally { setSaving(false); }
  };

  const addMember = async () => {
    if (!memberUserId) { toast.error("請選擇使用者"); return; }
    setAddingMemberLoading(true);
    try {
      await adminApi.addUserPosition(memberUserId, {
        position_id: positionId,
        start_date: memberStart,
        end_date: memberEnd || null,
      });
      toast.success("成員已新增");
      setAddingMember(false);
      setMemberUserId(""); setMemberSearch(""); setMemberEnd("");
      onUpdated();
    } catch (e) { toast.error(apiErrorMessage(e, "新增失敗")); }
    finally { setAddingMemberLoading(false); }
  };

  const removeMember = async (user: AdminUserDetail) => {
    const up = user.positions.find(p => p.id === positionId);
    if (!up?.user_position_id) return;
    if (!confirm(`確定移除「${user.display_name}」的此職位？`)) return;
    try {
      await adminApi.removeUserPosition(user.id, up.user_position_id);
      toast.success("已移除");
      onUpdated();
    } catch (e) { toast.error(apiErrorMessage(e, "移除失敗")); }
  };

  const deletePos = async () => {
    if (!confirm(`確定刪除職位「${pos.name}」？\n目前有 ${members.length} 位成員將失去此職位。`)) return;
    try {
      await adminApi.deletePosition(positionId);
      toast.success("職位已刪除");
      onUpdated();
    } catch (e) { toast.error(apiErrorMessage(e, "刪除失敗")); }
  };

  const saveHierarchy = async () => {
    let parentId: string | null = null;
    if (hierarchyMode !== "none" && !hierarchyTargetId) {
      toast.error("請選擇關係目標職位");
      return;
    }
    if (hierarchyMode === "parent") parentId = hierarchyTargetId;
    if (hierarchyMode === "sibling") {
      const target = orgPositions.find(p => p.id === hierarchyTargetId);
      parentId = target?.parent_id ?? null;
    }
    setSavingHierarchy(true);
    try {
      await adminApi.updatePosition(positionId, { parent_id: parentId });
      toast.success("職位階層已更新");
      setEditingHierarchy(false);
      onUpdated();
    } catch (e) {
      toast.error(apiErrorMessage(e, "更新失敗"));
    } finally {
      setSavingHierarchy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      {/* 標題列 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{pos.name}</h2>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--bg-elevated)", color: "var(--text-muted)" }}>
              {pos.org_name}
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {members.length} 位成員 · {pos.permission_codes.length} 個權限
          </p>
        </div>
        <button onClick={deletePos}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
          刪除職位
        </button>
      </div>

      {/* 權限碼 */}
      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>職位階層</h3>
          {!editingHierarchy
            ? <button onClick={() => { setEditingHierarchy(true); setHierarchyMode("none"); setHierarchyTargetId(""); }}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                編輯
              </button>
            : <div className="flex gap-2">
                <button onClick={() => setEditingHierarchy(false)}
                  className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-muted)" }}>取消</button>
                <button onClick={saveHierarchy} disabled={savingHierarchy}
                  className="text-xs px-3 py-1 rounded-lg font-medium disabled:opacity-50"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                  {savingHierarchy ? "儲存..." : "儲存"}
                </button>
              </div>
          }
        </div>
        {!editingHierarchy ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前上級：{parentName}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>關係模式</label>
              <select value={hierarchyMode} onChange={e => setHierarchyMode(e.target.value as "none" | "parent" | "sibling")}
                className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                <option value="none">無上級（頂層/平級）</option>
                <option value="parent">指定上級</option>
                <option value="sibling">與某職位平級</option>
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>目標職位</label>
              <select value={hierarchyTargetId} onChange={e => setHierarchyTargetId(e.target.value)}
                disabled={hierarchyMode === "none"}
                className="w-full text-sm rounded-lg px-3 py-2 outline-none disabled:opacity-50"
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>
                <option value="">選擇職位...</option>
                {orgPositions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </section>

      {/* 權限碼 */}
      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>職位權限</h3>
          {!editingPerms
            ? <button onClick={() => { setEditingPerms(true); setSelectedCodes(pos.permission_codes); }}
                className="text-xs px-3 py-1 rounded-lg"
                style={{ color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
                編輯
              </button>
            : <div className="flex gap-2">
                <button onClick={() => setEditingPerms(false)}
                  className="text-xs px-2 py-1 rounded" style={{ color: "var(--text-muted)" }}>取消</button>
                <button onClick={savePerms} disabled={saving}
                  className="text-xs px-3 py-1 rounded-lg font-medium disabled:opacity-50"
                  style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
                  {saving ? "儲存..." : "儲存"}
                </button>
              </div>
          }
        </div>

        {editingPerms ? (
          <PermCheckboxes selected={selectedCodes} onChange={setSelectedCodes} permCodes={permCodes} />
        ) : (
          pos.permission_codes.length === 0
            ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>無任何權限</p>
            : <div className="space-y-1.5">
                {pos.permission_codes.map(code => {
                  const info = permCodes.find(p => p.code === code);
                  return (
                    <div key={code}
                      className="flex items-start gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "var(--primary-dim)", border: "1px solid var(--primary-dim)" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" className="mt-0.5 flex-shrink-0"
                        style={{ color: "var(--primary)" }}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <div>
                        <p className="text-xs font-medium" style={{ color: "var(--primary)" }}>
                          {info?.label ?? code}
                        </p>
                        {info?.desc && (
                          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{info.desc}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
        )}
      </section>

      {/* 成員列表 */}
      <section className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between px-4 py-3"
          style={{ background: "var(--bg-elevated)", borderBottom: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            成員列表
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>({members.length} 人)</span>
          </h3>
          <button onClick={() => setAddingMember(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
            style={{ background: "var(--primary-dim)", color: "var(--primary)", border: "1px solid var(--border-strong)" }}>
            {addingMember ? "取消" : "+ 新增成員"}
          </button>
        </div>

        {/* 新增成員表單 */}
        {addingMember && (
          <div className="px-4 py-3 space-y-3" style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
            <input
              value={memberSearch}
              onChange={e => { setMemberSearch(e.target.value); setMemberUserId(""); }}
              placeholder="搜尋姓名或 Email..."
              className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
              style={{ border: "1px solid var(--border)" }}
            />
            {memberSearch && (
              <div className="max-h-36 overflow-y-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
                {filteredCandidates.slice(0, 8).map(u => (
                  <button key={u.id} onClick={() => { setMemberUserId(u.id); setMemberSearch(u.display_name); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:opacity-80 transition-colors">
                    <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                      style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                      {u.display_name.charAt(0)}
                    </div>
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>{u.display_name}</p>
                      <p style={{ color: "var(--text-muted)" }}>{u.email}</p>
                    </div>
                    {memberUserId === u.id && <span className="ml-auto" style={{ color: "var(--primary)" }}>✓</span>}
                  </button>
                ))}
                {filteredCandidates.length === 0 && (
                  <p className="text-xs text-center py-3" style={{ color: "var(--text-muted)" }}>無符合結果</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>任期開始 *</label>
                <input type="date" value={memberStart} onChange={e => setMemberStart(e.target.value)}
                  className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ border: "1px solid var(--border)", colorScheme: "dark" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>任期結束（留空＝無限）</label>
                <input type="date" value={memberEnd} onChange={e => setMemberEnd(e.target.value)}
                  className="w-full bg-transparent text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ border: "1px solid var(--border)", colorScheme: "dark" }} />
              </div>
            </div>
            <button onClick={addMember} disabled={!memberUserId || addingMemberLoading}
              className="w-full py-2 rounded-xl text-sm font-medium disabled:opacity-40 transition-all"
              style={{ background: "var(--primary)", color: "var(--primary-fg)" }}>
              {addingMemberLoading ? "新增中..." : "確認新增"}
            </button>
          </div>
        )}

        {/* 成員卡片 */}
        {members.length === 0 ? (
          <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>此職位尚無成員</div>
        ) : (
          <ul>
            {members.map((u, idx) => (
                <li key={u.id}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:opacity-80"
                  style={idx < members.length - 1 ? { borderBottom: "1px solid var(--border)" } : {}}>
                  <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                    style={{ background: "var(--primary-dim)", color: "var(--primary)" }}>
                    {u.display_name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{u.display_name}</span>
                      {!u.is_active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: "#f87171", background: "rgba(248,113,113,0.1)" }}>已停用</span>
                      )}
                    </div>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      {u.email}
                    </p>
                  </div>
                  {/* 學號 */}
                  <div className="text-xs text-right flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                    <p>學號</p>
                    <p style={{ color: "var(--text-secondary)" }}>
                      {u.student_id ?? "—"}
                    </p>
                  </div>
                  <button onClick={() => removeMember(u)}
                    className="text-xs px-2.5 py-1 rounded-lg flex-shrink-0 transition-colors hover:text-red-400"
                    style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    移除
                  </button>
                </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
