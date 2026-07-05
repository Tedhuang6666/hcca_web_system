"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, discordApi, governanceApi } from "@/lib/api";
import { useModuleStatus } from "@/contexts/ModuleStatusContext";
import type {
  DiscordChannelOptionOut,
  DiscordGuildOptionOut,
  DiscordRoleOptionOut,
  GovernanceDiscordEventRouteIn,
  GovernanceDiscordEventRouteOut,
  GovernanceDiscordWorkspaceIn,
  GovernanceDiscordWorkspaceOut,
} from "@/lib/types";

const EVENTS = [
  ["task.*", "任務"],
  ["activity.*", "活動"],
  ["document.*", "公文"],
  ["meeting.*", "會議"],
  ["announcement.*", "公告"],
  ["survey.*", "問卷"],
  ["regulation.*", "法規"],
  ["petition.*", "陳情"],
  ["calendar.*", "行事曆"],
] as const;

const emptyWorkspace = (): GovernanceDiscordWorkspaceIn => ({
  guild_id: "",
  mode: "existing",
  category_id: null,
  discussion_channel_id: null,
  announcement_channel_id: null,
  staff_channel_id: null,
  mention_role_id: null,
  auto_sync: true,
  is_active: true,
});

const emptyRoute = (): GovernanceDiscordEventRouteIn => ({
  event_type: EVENTS[0][0],
  channel_kind: "discussion",
  channel_id: null,
  create_thread: false,
  mention_role_id: null,
  is_active: true,
});

interface Props {
  matterId: string;
  initial: GovernanceDiscordWorkspaceOut | null;
}

export default function GovernanceDiscordPanel({ matterId, initial }: Props) {
  const { isModuleClosed } = useModuleStatus();
  const [guilds, setGuilds] = useState<DiscordGuildOptionOut[]>([]);
  const [channels, setChannels] = useState<DiscordChannelOptionOut[]>([]);
  const [roles, setRoles] = useState<DiscordRoleOptionOut[]>([]);
  const [workspace, setWorkspace] = useState<GovernanceDiscordWorkspaceOut | null>(initial);
  const [draft, setDraft] = useState<GovernanceDiscordWorkspaceIn>(
    initial ? {
      guild_id: initial.guild_id,
      mode: initial.mode,
      category_id: initial.category_id,
      discussion_channel_id: initial.discussion_channel_id,
      announcement_channel_id: initial.announcement_channel_id,
      staff_channel_id: initial.staff_channel_id,
      mention_role_id: initial.mention_role_id,
      auto_sync: initial.auto_sync,
      is_active: initial.is_active,
    } : emptyWorkspace(),
  );
  const [routes, setRoutes] = useState<GovernanceDiscordEventRouteOut[]>(
    initial?.routes ?? [],
  );
  const [routeDraft, setRouteDraft] = useState<GovernanceDiscordEventRouteIn>(emptyRoute);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void discordApi.availableGuilds().then(setGuilds).catch(() => setGuilds([]));
  }, []);

  useEffect(() => {
    if (!draft.guild_id) {
      setChannels([]);
      setRoles([]);
      return;
    }
    void Promise.all([
      discordApi.guildChannels(draft.guild_id),
      discordApi.guildRoles(draft.guild_id),
    ])
      .then(([nextChannels, nextRoles]) => {
        setChannels(nextChannels);
        setRoles(nextRoles.filter((role) => !role.managed));
      })
      .catch(() => {
        setChannels([]);
        setRoles([]);
      });
  }, [draft.guild_id]);

  const textChannels = useMemo(
    () => channels.filter((channel) => channel.type !== 4),
    [channels],
  );
  const categories = useMemo(
    () => channels.filter((channel) => channel.type === 4),
    [channels],
  );

  const saveWorkspace = async () => {
    if (!draft.guild_id) return;
    setBusy(true);
    try {
      const saved = await governanceApi.saveDiscordWorkspace(matterId, draft);
      setWorkspace(saved);
      setRoutes(saved.routes);
      toast.success(saved.mode === "managed" ? "已排程建立 Discord 工作區" : "已綁定 Discord 頻道");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Discord 工作區儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const saveRoute = async () => {
    if (!workspace) return;
    setBusy(true);
    try {
      const saved = await governanceApi.saveDiscordRoute(matterId, routeDraft);
      setRoutes((current) => [
        ...current.filter((route) => route.event_type !== saved.event_type),
        saved,
      ]);
      toast.success("事件推送路由已儲存");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "事件路由儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  if (isModuleClosed("discord")) return null;

  return (
    <details className="group rounded-lg" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h2 className="text-sm font-semibold">Discord 治理工作區</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            綁定既有頻道，或由 Bot 建立分類、討論、公告與核心工作頻道。
          </p>
        </div>
        <span className="btn btn-secondary btn-sm pointer-events-none">
          展開設定
        </span>
      </summary>
      <div className="px-5 pb-5 pt-0">
      <div className="flex flex-wrap items-start justify-end gap-3">
        {workspace && (
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setWorkspace(await governanceApi.syncDiscordWorkspace(matterId));
                toast.success("已排程同步 Discord 工作區");
              } finally {
                setBusy(false);
              }
            }}
          >
            立即同步
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <SelectField
          label="Discord 伺服器"
          value={draft.guild_id}
          options={guilds.map((guild) => [guild.id, guild.name])}
          placeholder="選擇伺服器"
          onChange={(value) => setDraft({ ...emptyWorkspace(), guild_id: value })}
        />
        <SelectField
          label="建立方式"
          value={draft.mode}
          options={[["existing", "綁定既有頻道"], ["managed", "建立完整工作區"]]}
          onChange={(value) =>
            setDraft((current) => ({ ...current, mode: value as "existing" | "managed" }))
          }
        />
        <SelectField
          label="預設 mention 身分組"
          value={draft.mention_role_id ?? ""}
          options={roles.map((role) => [role.id, role.name])}
          placeholder="不 mention"
          onChange={(value) =>
            setDraft((current) => ({ ...current, mention_role_id: value || null }))
          }
        />
        {draft.mode === "existing" && (
          <>
            <SelectField
              label="分類"
              value={draft.category_id ?? ""}
              options={categories.map((channel) => [channel.id, channel.name])}
              placeholder="不設定"
              onChange={(value) =>
                setDraft((current) => ({ ...current, category_id: value || null }))
              }
            />
            <ChannelField
              label="討論頻道"
              value={draft.discussion_channel_id}
              channels={textChannels}
              onChange={(value) =>
                setDraft((current) => ({ ...current, discussion_channel_id: value }))
              }
            />
            <ChannelField
              label="公告頻道"
              value={draft.announcement_channel_id}
              channels={textChannels}
              onChange={(value) =>
                setDraft((current) => ({ ...current, announcement_channel_id: value }))
              }
            />
            <ChannelField
              label="核心工作頻道"
              value={draft.staff_channel_id}
              channels={textChannels}
              onChange={(value) =>
                setDraft((current) => ({ ...current, staff_channel_id: value }))
              }
            />
          </>
        )}
      </div>
      <button
        className="btn btn-primary mt-4"
        disabled={
          busy ||
          !draft.guild_id ||
          (draft.mode === "existing" && !draft.discussion_channel_id)
        }
        onClick={saveWorkspace}
      >
        儲存工作區
      </button>
      {workspace?.last_error && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>{workspace.last_error}</p>
      )}

      <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
        <h3 className="text-sm font-semibold">模組事件推送</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <SelectField
            label="事件"
            value={routeDraft.event_type}
            options={EVENTS.map(([value, label]) => [value, label])}
            onChange={(value) =>
              setRouteDraft((current) => ({ ...current, event_type: value }))
            }
          />
          <SelectField
            label="目的地"
            value={routeDraft.channel_kind}
            options={[
              ["discussion", "討論頻道"],
              ["announcement", "公告頻道"],
              ["staff", "核心工作頻道"],
              ["custom", "指定既有頻道"],
            ]}
            onChange={(value) =>
              setRouteDraft((current) => ({
                ...current,
                channel_kind: value as GovernanceDiscordEventRouteIn["channel_kind"],
                channel_id: value === "custom" ? current.channel_id : null,
              }))
            }
          />
          <ChannelField
            label="指定頻道"
            value={routeDraft.channel_id}
            channels={textChannels}
            disabled={routeDraft.channel_kind !== "custom"}
            onChange={(value) =>
              setRouteDraft((current) => ({ ...current, channel_id: value }))
            }
          />
          <SelectField
            label="mention 身分組"
            value={routeDraft.mention_role_id ?? ""}
            options={roles.map((role) => [role.id, role.name])}
            placeholder="沿用工作區設定"
            onChange={(value) =>
              setRouteDraft((current) => ({ ...current, mention_role_id: value || null }))
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={routeDraft.create_thread}
              onChange={(event) =>
                setRouteDraft((current) => ({ ...current, create_thread: event.target.checked }))
              }
            />
            建立討論串
          </label>
          <button
            className="btn btn-secondary btn-sm"
            disabled={
              busy ||
              !workspace ||
              (routeDraft.channel_kind === "custom" && !routeDraft.channel_id)
            }
            onClick={saveRoute}
          >
            儲存事件路由
          </button>
        </div>
        {routes.length > 0 && (
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            已設定 {routes.length} 個事件路由
          </p>
        )}
      </div>
      </div>
    </details>
  );
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      <select
        className="input w-full"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function ChannelField({
  label,
  value,
  channels,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  channels: DiscordChannelOptionOut[];
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  return (
    <SelectField
      label={label}
      value={value ?? ""}
      options={channels.map((channel) => [channel.id, `#${channel.name}`])}
      placeholder={channels.length === 0 ? "尚無可選頻道" : "不設定"}
      disabled={disabled || channels.length === 0}
      onChange={(next) => onChange(next || null)}
    />
  );
}
