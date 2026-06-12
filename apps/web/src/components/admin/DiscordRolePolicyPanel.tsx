"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Combobox from "@/components/ui/Combobox";
import { ApiError, discordApi } from "@/lib/api";
import { orgDisplayName } from "@/lib/orgs";
import type {
  DiscordMemberSyncStateOut,
  DiscordRoleOptionOut,
  DiscordRolePolicyIn,
  DiscordRolePolicyOut,
  OrgRead,
  PositionSummary,
} from "@/lib/types";

interface Props {
  guildId: string;
  orgs: OrgRead[];
  positions: PositionSummary[];
  roles: DiscordRoleOptionOut[];
}

const emptyDraft = (guildId: string): DiscordRolePolicyIn => ({
  guild_id: guildId,
  role_id: "",
  role_name: null,
  org_id: null,
  position_id: null,
  nickname_label: null,
  priority: 100,
  manage_role: true,
  use_in_nickname: true,
  is_active: true,
});

export default function DiscordRolePolicyPanel({ guildId, orgs, positions, roles }: Props) {
  const [policies, setPolicies] = useState<DiscordRolePolicyOut[]>([]);
  const [states, setStates] = useState<DiscordMemberSyncStateOut[]>([]);
  const [draft, setDraft] = useState<DiscordRolePolicyIn>(() => emptyDraft(guildId));
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (!guildId) return;
    const [nextPolicies, nextStates] = await Promise.all([
      discordApi.listRolePolicies(guildId),
      discordApi.memberSyncStates(guildId, true),
    ]);
    setPolicies(nextPolicies);
    setStates(nextStates);
  };

  useEffect(() => {
    setDraft(emptyDraft(guildId));
    void reload().catch(() => {
      setPolicies([]);
      setStates([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guildId]);

  const filteredPositions = useMemo(
    () => positions.filter((position) => position.org_id === draft.org_id),
    [draft.org_id, positions],
  );
  const orgName = useMemo(
    () => Object.fromEntries(orgs.map((org) => [org.id, orgDisplayName(org, orgs)])),
    [orgs],
  );
  const positionName = useMemo(
    () => Object.fromEntries(positions.map((position) => [position.id, position.name])),
    [positions],
  );
  const roleName = useMemo(
    () => Object.fromEntries(roles.map((role) => [role.id, role.name])),
    [roles],
  );

  const save = async () => {
    const selectedRole = roles.find((role) => role.id === draft.role_id);
    if (!guildId || !draft.org_id || !draft.position_id || !selectedRole) return;
    setBusy(true);
    try {
      await discordApi.createRolePolicy({
        ...draft,
        guild_id: guildId,
        role_name: selectedRole.name,
        nickname_label: draft.nickname_label?.trim() || null,
      });
      setDraft(emptyDraft(guildId));
      await reload();
      toast.success("身分組政策已儲存並排程同步");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "儲存身分組政策失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold">職位、身分組與暱稱政策</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        先選組織與職位，再選 Discord 身分組。暱稱最多取兩個標籤，依優先級組成
        「新聞長&amp;活動｜原暱稱」。
      </p>
      {roles.length === 0 ? (
        <p className="mt-4 rounded border p-3 text-sm" style={{ borderColor: "var(--border)", color: "var(--danger)" }}>
          Discord Bot 尚未回報身分組，請確認連線後重試；資源載入後即可由選單設定。
        </p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <Combobox
            value={draft.org_id ?? ""}
            onChange={(value) => setDraft((current) => ({ ...current, org_id: value || null, position_id: null }))}
            options={orgs.map((org) => ({ value: org.id, label: orgDisplayName(org, orgs) }))}
            placeholder="搜尋組織"
          />
          <Combobox
            value={draft.position_id ?? ""}
            onChange={(value) => setDraft((current) => ({ ...current, position_id: value || null }))}
            options={filteredPositions.map((position) => ({ value: position.id, label: position.name }))}
            placeholder={draft.org_id ? "搜尋該組織職位" : "請先選組織"}
            disabled={!draft.org_id}
          />
          <Combobox
            value={draft.role_id}
            onChange={(value) => setDraft((current) => ({ ...current, role_id: value }))}
            options={roles.filter((role) => !role.managed).map((role) => ({
              value: role.id,
              label: role.name,
              description: `排序 ${role.position}`,
            }))}
            placeholder="搜尋 Discord 身分組"
          />
          <input
            className="input"
            value={draft.nickname_label ?? ""}
            maxLength={20}
            placeholder="暱稱標籤，例如 新聞長"
            onChange={(event) => setDraft((current) => ({ ...current, nickname_label: event.target.value }))}
          />
          <div className="flex gap-2">
            <input
              className="input min-w-0 flex-1"
              type="number"
              min={0}
              max={9999}
              value={draft.priority}
              aria-label="優先級"
              onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) }))}
            />
            <button className="btn btn-primary" disabled={busy || !draft.position_id || !draft.role_id} onClick={save}>
              儲存
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded border" style={{ borderColor: "var(--border)" }}>
        {policies.map((policy) => (
          <div key={policy.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <p className="text-sm font-medium">
                {orgName[policy.org_id ?? ""] ?? "未綁組織"} / {positionName[policy.position_id ?? ""] ?? "未綁職位"}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {roleName[policy.role_id] ?? policy.role_name ?? "未知身分組"} ·
                標籤 {policy.nickname_label || "不使用"} · 優先級 {policy.priority}
              </p>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy || !policy.is_active}
              onClick={async () => {
                setBusy(true);
                try {
                  await discordApi.deleteRolePolicy(policy.id);
                  await reload();
                } finally {
                  setBusy(false);
                }
              }}
            >
              {policy.is_active ? "停用" : "已停用"}
            </button>
          </div>
        ))}
        {policies.length === 0 && <p className="p-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>尚未設定角色政策</p>}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">角色差異與修復</h3>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy || states.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await discordApi.repairMemberSyncStates(
                states.map((state) => state.id),
              );
              toast.success(`已排程修復 ${result.queued} 位成員`);
            } finally {
              setBusy(false);
            }
          }}
        >
          修復全部差異
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {states.map((state) => (
          <div key={state.id} className="flex items-center justify-between rounded border p-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="text-sm">{state.actual_nickname || state.discord_user_id}</p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                實際 {state.actual_role_ids.length} 個 / 平台預期 {state.desired_role_ids.length} 個角色
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                暱稱：{state.actual_nickname || "未設定"} → {state.expected_nickname || "未設定"}
              </p>
              {state.last_error && (
                <p className="text-xs" style={{ color: "var(--danger)" }}>{state.last_error}</p>
              )}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={async () => {
              await discordApi.repairMemberSyncState(state.id);
              toast.success("已排程依平台狀態修復");
            }}>修復</button>
          </div>
        ))}
        {states.length === 0 && <p className="text-xs" style={{ color: "var(--text-muted)" }}>目前沒有受管角色差異。</p>}
      </div>
    </section>
  );
}
