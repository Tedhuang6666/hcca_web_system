"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, discordApi } from "@/lib/api";
import type {
  DiscordChannelOptionOut,
  DiscordNotificationEventOut,
  DiscordNotificationRouteIn,
  DiscordNotificationRouteOut,
  DiscordRoleOptionOut,
} from "@/lib/types";

type NamedOption = { id: string; name: string };

type Props = {
  guildId: string;
  channels: DiscordChannelOptionOut[];
  roles: DiscordRoleOptionOut[];
  orgs: NamedOption[];
  petitionTypes: NamedOption[];
};

const emptyDraft = (guildId: string): DiscordNotificationRouteIn => ({
  guild_id: guildId,
  event_key: "",
  module: "shop",
  channel_id: "",
  role_id: null,
  petition_type_id: null,
  org_id: null,
  priority: 100,
  mention_role: false,
  is_active: true,
});

export default function DiscordNotificationRoutePanel({
  guildId,
  channels,
  roles,
  orgs,
  petitionTypes,
}: Props) {
  const [events, setEvents] = useState<DiscordNotificationEventOut[]>([]);
  const [routes, setRoutes] = useState<DiscordNotificationRouteOut[]>([]);
  const [draft, setDraft] = useState<DiscordNotificationRouteIn>(() => emptyDraft(guildId));
  const [busy, setBusy] = useState(false);

  const eventName = useMemo(
    () => Object.fromEntries(events.map((event) => [event.key, event.label])),
    [events],
  );
  const channelName = useMemo(
    () => Object.fromEntries(channels.map((channel) => [channel.id, `#${channel.name}`])),
    [channels],
  );
  const roleName = useMemo(
    () => Object.fromEntries(roles.map((role) => [role.id, role.name])),
    [roles],
  );
  const orgName = useMemo(
    () => Object.fromEntries(orgs.map((org) => [org.id, org.name])),
    [orgs],
  );
  const petitionTypeName = useMemo(
    () => Object.fromEntries(petitionTypes.map((type) => [type.id, type.name])),
    [petitionTypes],
  );

  const load = useCallback(() => {
    if (!guildId) return;
    Promise.all([discordApi.notificationEvents(), discordApi.listNotificationRoutes(guildId)])
      .then(([nextEvents, nextRoutes]) => {
        setEvents(nextEvents);
        setRoutes(nextRoutes);
        setDraft((current) => {
          const selected = nextEvents.find((event) => event.key === current.event_key) ?? nextEvents[0];
          return {
            ...current,
            guild_id: guildId,
            event_key: selected?.key ?? "",
            module: selected?.module ?? "shop",
          };
        });
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入通知路由失敗"));
  }, [guildId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!draft.guild_id || !draft.event_key || !draft.channel_id) {
      toast.error("請選擇事件與 Discord 頻道");
      return;
    }
    setBusy(true);
    try {
      const saved = await discordApi.createNotificationRoute(draft);
      setRoutes((current) => [...current, saved]);
      setDraft((current) => ({ ...emptyDraft(guildId), event_key: current.event_key, module: current.module }));
      toast.success("通知路由已儲存");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "儲存通知路由失敗");
    } finally {
      setBusy(false);
    }
  };

  const disable = async (id: string) => {
    setBusy(true);
    try {
      await discordApi.deleteNotificationRoute(id);
      setRoutes((current) => current.map((route) => route.id === id ? { ...route, is_active: false } : route));
      toast.success("通知路由已停用");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "停用通知路由失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">模組通知路由</h2>
          <p className="mt-1 max-w-2xl text-xs" style={{ color: "var(--text-muted)" }}>
            依事件、陳情分類或負責機關，把通知送到指定頻道；可選擇標註設計部等 Discord 身分組。
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-xs" style={{ background: "var(--surface-hover)", color: "var(--text-muted)" }}>
          {routes.filter((route) => route.is_active).length} 條啟用
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>通知事件</span>
          <select
            className="input w-full"
            value={draft.event_key}
            disabled={!guildId || events.length === 0}
            onChange={(event) => {
              const selected = events.find((item) => item.key === event.target.value);
              setDraft((current) => ({ ...current, event_key: event.target.value, module: selected?.module ?? current.module }));
            }}
          >
            <option value="">選擇事件</option>
            {events.map((event) => <option key={event.key} value={event.key}>{event.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>送到頻道</span>
          <select className="input w-full" value={draft.channel_id} disabled={channels.length === 0} onChange={(event) => setDraft((current) => ({ ...current, channel_id: event.target.value }))}>
            <option value="">選擇頻道</option>
            {channels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>陳情分類（可選）</span>
          <select className="input w-full" value={draft.petition_type_id ?? ""} onChange={(event) => setDraft((current) => ({ ...current, petition_type_id: event.target.value || null }))}>
            <option value="">全部分類</option>
            {petitionTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>負責機關（可選）</span>
          <select className="input w-full" value={draft.org_id ?? ""} onChange={(event) => setDraft((current) => ({ ...current, org_id: event.target.value || null }))}>
            <option value="">全部機關</option>
            {orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs lg:col-span-2" style={{ color: "var(--text-muted)" }}>
          <span>標註身分組（可選）</span>
          <select className="input w-full" value={draft.role_id ?? ""} disabled={roles.length === 0} onChange={(event) => setDraft((current) => ({ ...current, role_id: event.target.value || null }))}>
            <option value="">不標註</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-xs lg:col-span-1" style={{ color: "var(--text-muted)" }}>
          <input type="checkbox" checked={Boolean(draft.mention_role)} disabled={!draft.role_id} onChange={(event) => setDraft((current) => ({ ...current, mention_role: event.target.checked }))} />
          發送時標註身分組
        </label>
        <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>優先序</span>
          <input className="input w-full" type="number" min={0} max={9999} value={draft.priority ?? 100} onChange={(event) => setDraft((current) => ({ ...current, priority: Number(event.target.value) }))} />
        </label>
      </div>
      <button className="btn btn-primary mt-4" disabled={busy || !guildId || !draft.event_key || !draft.channel_id} onClick={() => void save()}>
        新增通知路由
      </button>

      <div className="mt-5 overflow-hidden rounded border" style={{ borderColor: "var(--border)" }}>
        {routes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            尚未設定模組通知。先建立一條路由，Bot 才會依條件送出通知。
          </p>
        ) : (
          <ul>
            {routes.map((route) => (
              <li key={route.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)", opacity: route.is_active ? 1 : 0.55 }}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{eventName[route.event_key] ?? route.event_key} → {channelName[route.channel_id] ?? route.channel_id}</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    {route.petition_type_id ? `分類：${petitionTypeName[route.petition_type_id] ?? route.petition_type_id}` : "全部分類"}
                    {route.org_id ? ` · 機關：${orgName[route.org_id] ?? route.org_id}` : " · 全部機關"}
                    {route.role_id && route.mention_role ? ` · 標註 ${roleName[route.role_id] ?? route.role_id}` : ""}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" disabled={busy || !route.is_active} onClick={() => void disable(route.id)}>
                  {route.is_active ? "停用" : "已停用"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
