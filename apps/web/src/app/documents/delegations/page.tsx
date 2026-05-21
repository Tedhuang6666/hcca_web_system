"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ApiError, documentsApi, orgsApi, usersApi, withFallback } from "@/lib/api";
import type { OrgRead, UserSummary } from "@/lib/api";
import type { DocumentApprovalDelegationOut, UserPositionRead } from "@/lib/types";

function toInputValue(date: string | null) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 16);
}

export default function DocumentDelegationsPage() {
  const [delegations, setDelegations] = useState<DocumentApprovalDelegationOut[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [positions, setPositions] = useState<UserPositionRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    org_id: "",
    delegate_user_id: "",
    start_at: "",
    end_at: "",
    reason: "",
  });

  const myUserId = typeof window !== "undefined" ? localStorage.getItem("user_id") ?? "" : "";

  const myOrgOptions = useMemo(() => {
    const orgMap = new Map(orgs.map((org) => [org.id, org]));
    const unique = new Map<string, OrgRead>();
    for (const position of positions) {
      if (!position.position_org_id) continue;
      const org = orgMap.get(position.position_org_id);
      if (org) unique.set(org.id, org);
    }
    return [...unique.values()];
  }, [orgs, positions]);

  const delegateCandidates = useMemo(() => {
    const allowedOrgIds = new Set(myOrgOptions.map((org) => org.id));
    if (!form.org_id || !allowedOrgIds.has(form.org_id)) return [];
    return users.filter((user) => user.id !== myUserId);
  }, [form.org_id, myOrgOptions, myUserId, users]);

  const load = async () => {
    setLoading(true);
    const failedSections: string[] = [];
    const noteFailure = (label: string) => () => failedSections.push(label);
    const [delegationRows, orgRows, userRows, myPositions] = await Promise.all([
      withFallback(
        documentsApi.listDelegations({ include_inactive: showInactive }),
        [],
        noteFailure("代理清單"),
      ),
      withFallback(orgsApi.list({ active_only: true }), [], noteFailure("組織")),
      withFallback(usersApi.list(), [], noteFailure("使用者")),
      withFallback(usersApi.myPositions(true), [], noteFailure("我的職位")),
    ]);
    setDelegations(delegationRows);
    setOrgs(orgRows);
    setUsers(userRows);
    setPositions(myPositions);
    const defaultOrgId = myPositions[0]?.position_org_id ?? "";
    if (!form.org_id && defaultOrgId) {
      setForm((prev) => ({ ...prev, org_id: defaultOrgId }));
    }
    if (failedSections.length) {
      toast.warning(`${failedSections.join("、")}暫時無法載入，其餘代理設定仍可使用`);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      org_id: myOrgOptions[0]?.id ?? "",
      delegate_user_id: "",
      start_at: "",
      end_at: "",
      reason: "",
    });
  };

  const handleSubmit = async () => {
    if (!form.org_id || !form.delegate_user_id || !form.start_at) {
      toast.error("請完整填寫組織、代理人與開始時間");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        org_id: form.org_id,
        delegate_user_id: form.delegate_user_id,
        start_at: new Date(form.start_at).toISOString(),
        end_at: form.end_at ? new Date(form.end_at).toISOString() : null,
        reason: form.reason.trim() || null,
      };
      if (editingId) {
        await documentsApi.updateDelegation(editingId, payload);
        toast.success("代理授權已更新");
      } else {
        await documentsApi.createDelegation(payload);
        toast.success("代理授權已建立");
      }
      resetForm();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "儲存代理授權失敗");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (delegation: DocumentApprovalDelegationOut) => {
    setEditingId(delegation.id);
    setForm({
      org_id: delegation.org_id,
      delegate_user_id: delegation.delegate_user_id,
      start_at: toInputValue(delegation.start_at),
      end_at: toInputValue(delegation.end_at),
      reason: delegation.reason ?? "",
    });
  };

  const deactivate = async (id: string) => {
    if (!confirm("確定要停用這筆代理授權嗎？")) return;
    try {
      await documentsApi.deleteDelegation(id);
      toast.success("代理授權已停用");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "停用失敗");
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <Breadcrumb items={[
        { label: "公文系統", href: "/documents" },
        { label: "代理設定" },
      ]} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>公文簽核代理設定</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            設定請假期間的代行職權。送審中的公文與之後新送審的步驟都會自動套用。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInactive((prev) => !prev)}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ border: "1px solid var(--border)", color: "var(--text-muted)" }}
          >
            {showInactive ? "隱藏已停用" : "顯示已停用"}
          </button>
          <Link href="/documents" className="btn btn-ghost">返回公文</Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-[360px,1fr] gap-5">
        <section className="card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {editingId ? "修改代理授權" : "新增代理授權"}
            </h2>
            {editingId && (
              <button onClick={resetForm} className="text-xs" style={{ color: "var(--text-muted)" }}>
                取消編輯
              </button>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>所屬組織</label>
            <select
              value={form.org_id}
              onChange={(e) => setForm((prev) => ({ ...prev, org_id: e.target.value }))}
              className="input"
            >
              <option value="">請選擇組織</option>
              {myOrgOptions.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>代理人</label>
            <select
              value={form.delegate_user_id}
              onChange={(e) => setForm((prev) => ({ ...prev, delegate_user_id: e.target.value }))}
              className="input"
            >
              <option value="">請選擇代理人</option>
              {delegateCandidates.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.display_name} ({user.email})
                </option>
              ))}
            </select>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>開始時間</label>
              <input
                type="datetime-local"
                value={form.start_at}
                onChange={(e) => setForm((prev) => ({ ...prev, start_at: e.target.value }))}
                className="input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>結束時間</label>
              <input
                type="datetime-local"
                value={form.end_at}
                onChange={(e) => setForm((prev) => ({ ...prev, end_at: e.target.value }))}
                className="input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>請假 / 代行原因</label>
            <textarea
              rows={4}
              value={form.reason}
              onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
              className="input resize-none"
              placeholder="例如：期中考週請假，由副主席代行公文簽核。"
            />
          </div>

          <button onClick={handleSubmit} disabled={saving} className="btn btn-primary w-full">
            {saving ? "儲存中…" : editingId ? "更新代理授權" : "建立代理授權"}
          </button>
        </section>

        <section className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>既有代理授權</h2>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              共 {delegations.length} 筆
            </span>
          </div>

          {loading ? (
            <p className="text-sm text-center py-10" style={{ color: "var(--text-muted)" }}>載入中...</p>
          ) : delegations.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: "var(--text-muted)" }}>目前尚無代理授權</p>
          ) : (
            <div className="space-y-3">
              {delegations.map((delegation) => {
                const orgName = orgs.find((org) => org.id === delegation.org_id)?.name ?? delegation.org_id;
                return (
                  <article
                    key={delegation.id}
                    className="rounded-xl p-4"
                    style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                            {delegation.principal_user.name} → {delegation.delegate_user.name}
                          </span>
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-full"
                            style={{
                              color: delegation.is_active ? "var(--success)" : "var(--text-muted)",
                              background: delegation.is_active ? "var(--success-dim)" : "var(--bg-surface)",
                            }}
                          >
                            {delegation.is_active ? "生效中" : "已停用"}
                          </span>
                        </div>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{orgName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {delegation.is_active && (
                          <button onClick={() => startEdit(delegation)} className="text-xs px-2.5 py-1 rounded" style={{ color: "var(--primary)", background: "var(--primary-dim)" }}>
                            編輯
                          </button>
                        )}
                        {delegation.is_active && (
                          <button onClick={() => deactivate(delegation.id)} className="text-xs px-2.5 py-1 rounded" style={{ color: "var(--danger)", background: "rgba(220,38,38,0.1)" }}>
                            停用
                          </button>
                        )}
                      </div>
                    </div>

                    <dl className="grid sm:grid-cols-2 gap-3 mt-3 text-xs">
                      <div>
                        <dt style={{ color: "var(--text-muted)" }}>代理期間</dt>
                        <dd className="mt-1" style={{ color: "var(--text-secondary)" }}>
                          {new Date(delegation.start_at).toLocaleString("zh-TW")}
                          {" "}至{" "}
                          {delegation.end_at ? new Date(delegation.end_at).toLocaleString("zh-TW") : "未設定結束"}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--text-muted)" }}>建立時間</dt>
                        <dd className="mt-1" style={{ color: "var(--text-secondary)" }}>
                          {new Date(delegation.created_at).toLocaleString("zh-TW")}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-3">
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>原因</p>
                      <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                        {delegation.reason || "未填寫"}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
