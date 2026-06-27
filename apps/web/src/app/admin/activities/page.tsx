"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { activitiesApi, adminApi, discordApi, orgsApi } from "@/lib/api";
import { cacheGet, cacheHas, cacheSet, cachePurge } from "@/lib/api-cache";
import type {
  Activity,
  ActivityConvener,
  ActivityMember,
  ActivityRole,
  AdminUserDetail,
  DiscordActivityWorkspace,
  DiscordGuildOptionOut,
  OrgRead,
} from "@/lib/types";
import { today } from "@/lib/dateUtils";

const STATUS_LABEL: Record<Activity["status"], string> = {
  draft: "草稿",
  active: "進行中",
  ended: "已結束",
  archived: "已封存",
};

const ACT_LIST_KEY = "admin/activities/list";
const ACT_ORGS_KEY = "admin/activities/orgs";
const ACT_USERS_KEY = "admin/activities/users";

export default function AdminActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>(() => cacheGet<Activity[]>(ACT_LIST_KEY) ?? []);
  const [orgs, setOrgs] = useState<OrgRead[]>(() => cacheGet<OrgRead[]>(ACT_ORGS_KEY) ?? []);
  const [users, setUsers] = useState<AdminUserDetail[]>(() => cacheGet<AdminUserDetail[]>(ACT_USERS_KEY) ?? []);
  const [selectedId, setSelectedId] = useState("");
  const [conveners, setConveners] = useState<ActivityConvener[]>([]);
  const [roles, setRoles] = useState<ActivityRole[]>([]);
  const [members, setMembers] = useState<ActivityMember[]>([]);
  const [discordGuilds, setDiscordGuilds] = useState<DiscordGuildOptionOut[]>([]);
  const [discordWorkspace, setDiscordWorkspace] = useState<DiscordActivityWorkspace | null>(null);
  const [loading, setLoading] = useState(!cacheHas(ACT_LIST_KEY));
  const [form, setForm] = useState({ name: "", org_id: "", description: "", starts_at: "", ends_at: "" });
  const [appoint, setAppoint] = useState({ user_id: "", start_date: today(), end_date: "" });
  const [workspaceDraft, setWorkspaceDraft] = useState({ guild_id: "", auto_sync: true });
  const [roleDraft, setRoleDraft] = useState({ key: "", name: "", create_private_channel: false });
  const [memberDraft, setMemberDraft] = useState({
    role_id: "",
    user_id: "",
    start_date: today(),
    end_date: "",
  });

  const selected = useMemo(
    () => activities.find((activity) => activity.id === selectedId) ?? activities[0],
    [activities, selectedId],
  );

  const reload = useCallback(async () => {
    if (!cacheHas(ACT_LIST_KEY)) setLoading(true);
    try {
      const [activityRows, orgRows, userRows] = await Promise.all([
        activitiesApi.list(),
        orgsApi.list({ active_only: true }),
        adminApi.listUsers({ active_only: true, limit: 200 }),
      ]);
      setActivities(activityRows);
      cacheSet(ACT_LIST_KEY, activityRows);
      setOrgs(orgRows);
      cacheSet(ACT_ORGS_KEY, orgRows);
      setUsers(userRows);
      cacheSet(ACT_USERS_KEY, userRows);
      discordApi.availableGuilds().then(setDiscordGuilds).catch(() => setDiscordGuilds([]));
      if (!selectedId && activityRows[0]) setSelectedId(activityRows[0].id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "載入活動資料失敗");
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected?.id) {
      setConveners([]);
      return;
    }
    Promise.all([
      activitiesApi.listConveners(selected.id),
      activitiesApi.listRoles(selected.id),
      activitiesApi.listMembers(selected.id),
      activitiesApi.discordWorkspace(selected.id),
    ])
      .then(([convenerRows, roleRows, memberRows, workspace]) => {
        setConveners(convenerRows);
        setRoles(roleRows);
        setMembers(memberRows);
        setDiscordWorkspace(workspace);
        setWorkspaceDraft({
          guild_id: workspace?.guild_id ?? "",
          auto_sync: workspace?.auto_sync ?? true,
        });
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "載入總召失敗"));
  }, [selected?.id]);

  const createActivity = async () => {
    if (!form.name.trim()) return toast.error("請輸入活動名稱");
    try {
      const created = await activitiesApi.create({
        name: form.name.trim(),
        org_id: form.org_id || null,
        description: form.description.trim() || null,
        starts_at: form.starts_at || null,
        ends_at: form.ends_at || null,
        status: "active",
      });
      toast.success("已建立活動");
      cachePurge("admin/activities");
      setForm({ name: "", org_id: "", description: "", starts_at: "", ends_at: "" });
      setSelectedId(created.id);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立活動失敗");
    }
  };

  const archiveSelected = async () => {
    if (!selected) return;
    try {
      await activitiesApi.archive(selected.id);
      toast.success("已封存活動");
      cachePurge("admin/activities");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "封存活動失敗");
    }
  };

  const appointConvener = async () => {
    if (!selected || !appoint.user_id) return toast.error("請選擇總召");
    try {
      await activitiesApi.appointConvener(selected.id, {
        user_id: appoint.user_id,
        start_date: appoint.start_date || today(),
        end_date: appoint.end_date || null,
      });
      toast.success("已任命總召");
      setAppoint({ user_id: "", start_date: today(), end_date: "" });
      setConveners(await activitiesApi.listConveners(selected.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任命總召失敗");
    }
  };

  const removeConvener = async (id: string) => {
    if (!selected) return;
    try {
      await activitiesApi.removeConvener(id);
      toast.success("已卸任總召");
      setConveners(await activitiesApi.listConveners(selected.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "卸任總召失敗");
    }
  };

  const saveDiscordWorkspace = async () => {
    if (!selected || !workspaceDraft.guild_id) return toast.error("請選擇 Discord 伺服器");
    try {
      const saved = await activitiesApi.saveDiscordWorkspace(selected.id, {
        guild_id: workspaceDraft.guild_id,
        category_id: discordWorkspace?.category_id ?? null,
        general_channel_id: discordWorkspace?.general_channel_id ?? null,
        announcement_channel_id: discordWorkspace?.announcement_channel_id ?? null,
        staff_channel_id: discordWorkspace?.staff_channel_id ?? null,
        convener_role_id: discordWorkspace?.convener_role_id ?? null,
        auto_sync: workspaceDraft.auto_sync,
        is_active: true,
      });
      setDiscordWorkspace(saved);
      toast.success("已排入 Discord 活動工作區同步");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "設定 Discord 工作區失敗");
    }
  };

  const syncDiscordWorkspace = async () => {
    if (!selected) return;
    try {
      setDiscordWorkspace(await activitiesApi.syncDiscordWorkspace(selected.id));
      toast.success("已重新排入完整同步");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步失敗");
    }
  };

  const createRole = async () => {
    if (!selected || !roleDraft.key.trim() || !roleDraft.name.trim()) {
      return toast.error("請填寫職務代碼與名稱");
    }
    try {
      await activitiesApi.createRole(selected.id, {
        key: roleDraft.key.trim().toLowerCase(),
        name: roleDraft.name.trim(),
        create_private_channel: roleDraft.create_private_channel,
      });
      setRoleDraft({ key: "", name: "", create_private_channel: false });
      setRoles(await activitiesApi.listRoles(selected.id));
      toast.success("已建立活動職務");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "建立職務失敗");
    }
  };

  const appointMember = async () => {
    if (!selected || !memberDraft.role_id || !memberDraft.user_id) {
      return toast.error("請選擇職務與成員");
    }
    try {
      await activitiesApi.appointMember(selected.id, {
        ...memberDraft,
        end_date: memberDraft.end_date || null,
      });
      setMemberDraft({ role_id: "", user_id: "", start_date: today(), end_date: "" });
      setMembers(await activitiesApi.listMembers(selected.id));
      toast.success("已任命活動職務並排入 Discord 同步");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "任命活動職務失敗");
    }
  };

  const removeMember = async (memberId: string) => {
    if (!selected) return;
    await activitiesApi.removeMember(selected.id, memberId);
    setMembers(await activitiesApi.listMembers(selected.id));
    toast.success("已卸任並排入 Discord 同步");
  };

  return (
    <main className="mx-auto flex max-w-7xl gap-6 p-6">
      <section className="w-80 shrink-0">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>活動管理</h1>
          <button className="rounded border px-3 py-1.5 text-sm" onClick={() => void reload()} disabled={loading}>重新整理</button>
        </div>
        <div className="space-y-2">
          {activities.map((activity) => (
            <button
              key={activity.id}
              onClick={() => setSelectedId(activity.id)}
              className="block w-full rounded border p-3 text-left text-sm"
              style={{
                borderColor: activity.id === selected?.id ? "var(--brand)" : "var(--border)",
                background: activity.id === selected?.id ? "var(--bg-elevated)" : "transparent",
              }}
            >
              <span className="block font-medium" style={{ color: "var(--text-primary)" }}>{activity.name}</span>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{STATUS_LABEL[activity.status]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-base font-semibold" style={{ color: "var(--text-primary)" }}>建立活動</h2>
          <div className="space-y-3">
            <input className="w-full rounded border px-3 py-2" placeholder="活動名稱" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="w-full rounded border px-3 py-2" value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })}>
              <option value="">不隸屬組織</option>
              {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <textarea className="w-full rounded border px-3 py-2" placeholder="說明" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded border px-3 py-2" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
              <input className="rounded border px-3 py-2" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </div>
            <button className="rounded px-4 py-2 text-sm text-white" style={{ background: "var(--brand)" }} onClick={() => void createActivity()}>建立</button>
          </div>
        </div>

        <div className="rounded border p-4" style={{ borderColor: "var(--border)" }}>
          <h2 className="mb-3 text-base font-semibold" style={{ color: "var(--text-primary)" }}>{selected?.name ?? "選擇活動"}</h2>
          {selected && (
            <div className="space-y-4">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{selected.description || "無說明"}</p>
              <div className="flex flex-wrap gap-2">
                <Link className="rounded border px-3 py-1.5 text-sm" href={`/activities/${selected.id}`}>開啟工作區</Link>
                <Link className="rounded border px-3 py-1.5 text-sm" href={`/shop/admin?activity_id=${selected.id}`}>商品 / 票券</Link>
                <Link className="rounded border px-3 py-1.5 text-sm" href={`/shop?activity_id=${selected.id}`}>購票頁</Link>
                <button className="rounded border px-3 py-1.5 text-sm" onClick={() => void archiveSelected()} disabled={selected.status === "archived"}>封存活動</button>
              </div>
              <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <h3 className="mb-2 text-sm font-medium">活動總召</h3>
                <div className="mb-3 grid grid-cols-1 gap-2 xl:grid-cols-[1fr_120px_120px_auto]">
                  <select className="rounded border px-3 py-2" value={appoint.user_id} onChange={(e) => setAppoint({ ...appoint, user_id: e.target.value })}>
                    <option value="">選擇使用者</option>
                    {users.map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.email}</option>)}
                  </select>
                  <input className="rounded border px-3 py-2" type="date" value={appoint.start_date} onChange={(e) => setAppoint({ ...appoint, start_date: e.target.value })} />
                  <input className="rounded border px-3 py-2" type="date" value={appoint.end_date} onChange={(e) => setAppoint({ ...appoint, end_date: e.target.value })} />
                  <button className="rounded px-3 py-2 text-sm text-white" style={{ background: "var(--brand)" }} onClick={() => void appointConvener()}>任命</button>
                </div>
                <div className="space-y-2">
                  {conveners.map((convener) => (
                    <div key={convener.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <span>{convener.user_name || convener.user_email} · {convener.start_date} 至 {convener.end_date || "未定"}</span>
                      <button className="rounded border px-2 py-1 text-xs" onClick={() => void removeConvener(convener.id)}>卸任</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded border p-4 lg:col-span-2" style={{ borderColor: "var(--border)" }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Discord 活動整合</h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                自動建立活動分類、公告／討論／核心頻道、職務身分組與職務私頻。
              </p>
            </div>
            {discordWorkspace && (
              <span className="rounded border px-2 py-1 text-xs">
                同步狀態：{discordWorkspace.sync_status}
              </span>
            )}
          </div>
          {selected ? (
            <div className="space-y-5">
              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <select
                  className="rounded border px-3 py-2"
                  value={workspaceDraft.guild_id}
                  onChange={(e) => setWorkspaceDraft({ ...workspaceDraft, guild_id: e.target.value })}
                >
                  <option value="">選擇 Discord 伺服器</option>
                  {discordGuilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
                </select>
                <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={workspaceDraft.auto_sync}
                    onChange={(e) => setWorkspaceDraft({ ...workspaceDraft, auto_sync: e.target.checked })}
                  />
                  異動自動同步
                </label>
                <div className="flex gap-2">
                  <button className="rounded px-3 py-2 text-sm text-white" style={{ background: "var(--brand)" }} onClick={() => void saveDiscordWorkspace()}>儲存並建立</button>
                  <button className="rounded border px-3 py-2 text-sm" disabled={!discordWorkspace} onClick={() => void syncDiscordWorkspace()}>完整同步</button>
                </div>
              </div>
              {discordWorkspace?.last_error && <p className="text-sm text-red-600">{discordWorkspace.last_error}</p>}

              <div className="grid gap-5 xl:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-medium">活動職務與 Discord 身分組</h3>
                  <div className="mb-3 grid gap-2 md:grid-cols-[140px_1fr_auto_auto]">
                    <input className="rounded border px-3 py-2" placeholder="代碼，如 media" value={roleDraft.key} onChange={(e) => setRoleDraft({ ...roleDraft, key: e.target.value })} />
                    <input className="rounded border px-3 py-2" placeholder="職務名稱" value={roleDraft.name} onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })} />
                    <label className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                      <input type="checkbox" checked={roleDraft.create_private_channel} onChange={(e) => setRoleDraft({ ...roleDraft, create_private_channel: e.target.checked })} />
                      建立私頻
                    </label>
                    <button className="rounded border px-3 py-2 text-sm" onClick={() => void createRole()}>新增職務</button>
                  </div>
                  <div className="space-y-2">
                    {roles.map((role) => (
                      <div key={role.id} className="rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{role.name} <span style={{ color: "var(--text-muted)" }}>({role.key})</span></span>
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{role.create_private_channel ? "身分組＋私頻" : "身分組"}</span>
                        </div>
                        {role.discord_role_id && <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>Role {role.discord_role_id}{role.discord_channel_id ? ` · Channel ${role.discord_channel_id}` : ""}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium">活動成員任命</h3>
                  <div className="mb-3 grid gap-2 md:grid-cols-2">
                    <select className="rounded border px-3 py-2" value={memberDraft.role_id} onChange={(e) => setMemberDraft({ ...memberDraft, role_id: e.target.value })}>
                      <option value="">選擇活動職務</option>
                      {roles.filter((role) => role.is_active).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                    </select>
                    <select className="rounded border px-3 py-2" value={memberDraft.user_id} onChange={(e) => setMemberDraft({ ...memberDraft, user_id: e.target.value })}>
                      <option value="">選擇使用者</option>
                      {users.map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.email}</option>)}
                    </select>
                    <input className="rounded border px-3 py-2" type="date" value={memberDraft.start_date} onChange={(e) => setMemberDraft({ ...memberDraft, start_date: e.target.value })} />
                    <div className="flex gap-2">
                      <input className="min-w-0 flex-1 rounded border px-3 py-2" type="date" value={memberDraft.end_date} onChange={(e) => setMemberDraft({ ...memberDraft, end_date: e.target.value })} />
                      <button className="rounded border px-3 py-2 text-sm" onClick={() => void appointMember()}>任命</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {members.map((member) => (
                      <div key={member.id} className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                        <span>{member.user_name || member.user_email} · {member.role_name} · {member.start_date} 至 {member.end_date || "未定"}</span>
                        <button className="rounded border px-2 py-1 text-xs" onClick={() => void removeMember(member.id)}>卸任</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : <p className="text-sm" style={{ color: "var(--text-muted)" }}>請先選擇活動。</p>}
        </div>
      </section>
    </main>
  );
}
