"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { adminApi, ApiError, discordApi, orgsApi } from "@/lib/api";
import { orgDisplayName } from "@/lib/orgs";
import type {
  DiscordGuildConfigIn,
  DiscordGuildConfigOut,
  DiscordChannelOptionOut,
  DiscordGuildOptionOut,
  DiscordBotHealthOut,
  DiscordNicknamePrefixRuleIn,
  DiscordNicknamePrefixRuleOut,
  DiscordOrgChannelMappingIn,
  DiscordOrgChannelMappingOut,
  DiscordRoleMappingIn,
  DiscordRoleMappingKind,
  DiscordRoleMappingOut,
  DiscordRoleOptionOut,
  OrgRead,
  PositionSummary,
} from "@/lib/types";

const emptyConfig: DiscordGuildConfigIn = {
  guild_id: "",
  name: "",
  office_channel_id: "",
  security_alert_channel_id: "",
  petition_entry_channel_id: "",
  petition_private_category_id: "",
  petition_staff_role_id: "",
  petition_private_channel_enabled: true,
  announcement_channel_id: "",
  moderation_log_channel_id: "",
  welcome_channel_id: "",
  admin_role_id: "",
  is_active: true,
};

export default function DiscordAdminPage() {
  const [, setConfigs] = useState<DiscordGuildConfigOut[]>([]);
  const [mappings, setMappings] = useState<DiscordRoleMappingOut[]>([]);
  const [nicknameRules, setNicknameRules] = useState<DiscordNicknamePrefixRuleOut[]>([]);
  const [orgChannelMappings, setOrgChannelMappings] = useState<DiscordOrgChannelMappingOut[]>([]);
  const [orgs, setOrgs] = useState<OrgRead[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [guildOptions, setGuildOptions] = useState<DiscordGuildOptionOut[]>([]);
  const [channelOptions, setChannelOptions] = useState<DiscordChannelOptionOut[]>([]);
  const [roleOptions, setRoleOptions] = useState<DiscordRoleOptionOut[]>([]);
  const [health, setHealth] = useState<DiscordBotHealthOut | null>(null);
  const [discordFetchError, setDiscordFetchError] = useState<string | null>(null);
  const [loadingDiscordMeta, setLoadingDiscordMeta] = useState(false);
  const [configDraft, setConfigDraft] = useState<DiscordGuildConfigIn>(emptyConfig);
  const [mappingDraft, setMappingDraft] = useState<DiscordRoleMappingIn>({
    guild_id: "",
    role_id: "",
    mapping_kind: "position",
    org_id: null,
    position_id: null,
    is_active: true,
  });
  const [orgChannelDraft, setOrgChannelDraft] = useState<DiscordOrgChannelMappingIn>({
    guild_id: "",
    org_id: "",
    channel_id: "",
    is_active: true,
  });
  const [nicknameDraft, setNicknameDraft] = useState<DiscordNicknamePrefixRuleIn>({
    guild_id: "",
    prefix: "【主席】",
    priority: 10,
    mapping_kind: "position",
    org_id: null,
    position_id: null,
    is_active: true,
  });
  const [busy, setBusy] = useState(false);

  const orgName = useMemo(
    () => Object.fromEntries(orgs.map((org) => [org.id, orgDisplayName(org, orgs)])),
    [orgs],
  );
  const positionName = useMemo(
    () => Object.fromEntries(positions.map((position) => [position.id, position.name])),
    [positions],
  );
  const roleName = useMemo(
    () => Object.fromEntries(roleOptions.map((role) => [role.id, role.name])),
    [roleOptions],
  );

  useEffect(() => {
    Promise.all([
      discordApi.listGuildConfigs(),
      discordApi.listRoleMappings(),
      discordApi.listNicknamePrefixRules(),
      discordApi.listOrgChannelMappings(),
      discordApi.health().catch(() => null),
      orgsApi.list({ active_only: true }),
      adminApi.listPositions(),
      discordApi.availableGuilds().catch((error) => {
        setDiscordFetchError(error instanceof ApiError ? error.message : "無法讀取 Discord 伺服器清單");
        return [] as DiscordGuildOptionOut[];
      }),
    ])
      .then((
        [
          nextConfigs,
          nextMappings,
          nextNicknameRules,
          nextOrgChannels,
          nextHealth,
          nextOrgs,
          nextPositions,
          nextGuilds,
        ],
      ) => {
        setConfigs(nextConfigs);
        setMappings(nextMappings);
        setNicknameRules(nextNicknameRules);
        setOrgChannelMappings(nextOrgChannels);
        setHealth(nextHealth);
        setOrgs(nextOrgs);
        setPositions(nextPositions);
        setGuildOptions(nextGuilds);
        if (nextConfigs[0]) {
          setConfigDraft({
            guild_id: nextConfigs[0].guild_id,
            name: nextConfigs[0].name,
            office_channel_id: nextConfigs[0].office_channel_id,
            security_alert_channel_id: nextConfigs[0].security_alert_channel_id,
            petition_entry_channel_id: nextConfigs[0].petition_entry_channel_id,
            petition_private_category_id: nextConfigs[0].petition_private_category_id,
            petition_staff_role_id: nextConfigs[0].petition_staff_role_id,
            petition_private_channel_enabled: nextConfigs[0].petition_private_channel_enabled,
            announcement_channel_id: nextConfigs[0].announcement_channel_id,
            moderation_log_channel_id: nextConfigs[0].moderation_log_channel_id,
            welcome_channel_id: nextConfigs[0].welcome_channel_id,
            admin_role_id: nextConfigs[0].admin_role_id,
            is_active: nextConfigs[0].is_active,
          });
          setMappingDraft((current) => ({ ...current, guild_id: nextConfigs[0].guild_id }));
          setOrgChannelDraft((current) => ({ ...current, guild_id: nextConfigs[0].guild_id }));
          setNicknameDraft((current) => ({ ...current, guild_id: nextConfigs[0].guild_id }));
        } else if (nextGuilds[0]) {
          setConfigDraft((current) => ({
            ...current,
            guild_id: nextGuilds[0].id,
            name: nextGuilds[0].name,
          }));
          setMappingDraft((current) => ({ ...current, guild_id: nextGuilds[0].id }));
          setOrgChannelDraft((current) => ({ ...current, guild_id: nextGuilds[0].id }));
          setNicknameDraft((current) => ({ ...current, guild_id: nextGuilds[0].id }));
        }
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : "載入 Discord 設定失敗"));
  }, []);

  useEffect(() => {
    if (!configDraft.guild_id) {
      setChannelOptions([]);
      setRoleOptions([]);
      return;
    }
    setLoadingDiscordMeta(true);
    Promise.all([
      discordApi.guildChannels(configDraft.guild_id),
      discordApi.guildRoles(configDraft.guild_id),
    ])
      .then(([channels, roles]) => {
        setChannelOptions(channels);
        setRoleOptions(roles);
        setDiscordFetchError(null);
      })
      .catch((error) => {
        setChannelOptions([]);
        setRoleOptions([]);
        setDiscordFetchError(error instanceof ApiError ? error.message : "無法讀取 Discord 頻道或身分組");
      })
      .finally(() => setLoadingDiscordMeta(false));
  }, [configDraft.guild_id]);

  const saveConfig = async () => {
    setBusy(true);
    try {
      const saved = await discordApi.saveGuildConfig(configDraft);
      setConfigs((current) => [saved, ...current.filter((item) => item.guild_id !== saved.guild_id)]);
      setMappingDraft((current) => ({ ...current, guild_id: saved.guild_id }));
      setOrgChannelDraft((current) => ({ ...current, guild_id: saved.guild_id }));
      setNicknameDraft((current) => ({ ...current, guild_id: saved.guild_id }));
      toast.success("Discord 伺服器設定已儲存");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const saveOrgChannelMapping = async () => {
    setBusy(true);
    try {
      const saved = await discordApi.saveOrgChannelMapping(orgChannelDraft);
      setOrgChannelMappings((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id && item.org_id !== saved.org_id),
      ]);
      setOrgChannelDraft((current) => ({ ...current, org_id: "", channel_id: "" }));
      toast.success("機關公告頻道已儲存");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const disableOrgChannelMapping = async (id: string) => {
    setBusy(true);
    try {
      await discordApi.deleteOrgChannelMapping(id);
      setOrgChannelMappings((current) =>
        current.map((item) => (item.id === id ? { ...item, is_active: false } : item)),
      );
      toast.success("機關公告頻道已停用");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "停用失敗");
    } finally {
      setBusy(false);
    }
  };

  const createMapping = async () => {
    setBusy(true);
    try {
      const saved = await discordApi.createRoleMapping(mappingDraft);
      setMappings((current) => [saved, ...current]);
      toast.success("身分組映射已建立，已排程同步已綁定成員");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const createNicknameRule = async () => {
    setBusy(true);
    try {
      const saved = await discordApi.createNicknamePrefixRule(nicknameDraft);
      setNicknameRules((current) => [saved, ...current]);
      toast.success("暱稱前綴規則已建立，已排程同步已綁定成員");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const disableNicknameRule = async (id: string) => {
    setBusy(true);
    try {
      await discordApi.deleteNicknamePrefixRule(id);
      setNicknameRules((current) =>
        current.map((item) => (item.id === id ? { ...item, is_active: false } : item)),
      );
      toast.success("暱稱前綴規則已停用，已排程同步已綁定成員");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "停用失敗");
    } finally {
      setBusy(false);
    }
  };

  const disableMapping = async (id: string) => {
    setBusy(true);
    try {
      await discordApi.deleteRoleMapping(id);
      setMappings((current) =>
        current.map((item) => (item.id === id ? { ...item, is_active: false } : item)),
      );
      toast.success("身分組映射已停用，已排程同步已綁定成員");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "停用失敗");
    } finally {
      setBusy(false);
    }
  };

  const setMappingKind = (mapping_kind: DiscordRoleMappingKind) => {
    setMappingDraft((current) => ({
      ...current,
      mapping_kind,
      org_id: mapping_kind === "org" ? current.org_id : null,
      position_id: mapping_kind === "position" ? current.position_id : null,
    }));
  };

  const selectGuild = (guildId: string) => {
    const guild = guildOptions.find((item) => item.id === guildId);
    setConfigDraft((current) => ({
      ...current,
      guild_id: guildId,
      name: guild?.name ?? current.name,
      office_channel_id: null,
      security_alert_channel_id: null,
      petition_entry_channel_id: null,
      petition_private_category_id: null,
      petition_staff_role_id: null,
      petition_private_channel_enabled: true,
      announcement_channel_id: null,
      moderation_log_channel_id: null,
      welcome_channel_id: null,
      admin_role_id: null,
    }));
    setMappingDraft((current) => ({ ...current, guild_id: guildId, role_id: "" }));
    setOrgChannelDraft((current) => ({ ...current, guild_id: guildId, channel_id: "" }));
    setNicknameDraft((current) => ({ ...current, guild_id: guildId }));
  };

  const channelField = (
    key: keyof Pick<
      DiscordGuildConfigIn,
      | "office_channel_id"
      | "security_alert_channel_id"
      | "petition_entry_channel_id"
      | "petition_private_category_id"
      | "announcement_channel_id"
      | "moderation_log_channel_id"
      | "welcome_channel_id"
    >,
    label: string,
  ) => (
    <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      {channelOptions.length > 0 ? (
        <select
          className="input w-full"
          value={configDraft[key] ?? ""}
          onChange={(event) =>
            setConfigDraft((current) => ({ ...current, [key]: event.target.value || null }))
          }
        >
          <option value="">不設定</option>
          {channelOptions
            .filter((channel) => key === "petition_private_category_id" ? channel.type === 4 : channel.type !== 4)
            .map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.type === 4 ? "分類：" : "#"}{channel.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input w-full"
          placeholder="手動輸入頻道 ID"
          value={configDraft[key] ?? ""}
          onChange={(event) =>
            setConfigDraft((current) => ({ ...current, [key]: event.target.value || null }))
          }
        />
      )}
    </label>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <p className="text-xs font-semibold tracking-widest" style={{ color: "var(--primary)" }}>
          DISCORD BOT
        </p>
        <h1 className="mt-1 text-xl font-semibold">Discord 平台機器人設定</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          設定辦公頻道、資安警報頻道，以及平台組織/職位到 Discord 身分組的同步規則。
        </p>
      </header>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">Bot 狀態與維運</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="rounded border px-3 py-2" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Bot Token</p>
            <p className="text-sm font-semibold">{health?.bot_configured ? "已設定" : "未確認"}</p>
          </div>
          <div className="rounded border px-3 py-2" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>OAuth</p>
            <p className="text-sm font-semibold">{health?.oauth_configured ? "已設定" : "未確認"}</p>
          </div>
          <div className="rounded border px-3 py-2" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Bot</p>
            <p className="truncate text-sm font-semibold">{health?.bot_username ?? "尚無資料"}</p>
          </div>
          <div className="rounded border px-3 py-2" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>綁定帳號</p>
            <p className="text-sm font-semibold">{health?.has_active_links ? "已有" : "尚未確認"}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const next = await discordApi.health();
                setHealth(next);
                toast.success("Discord Bot 狀態已更新");
              } catch (error) {
                toast.error(error instanceof ApiError ? error.message : "狀態檢查失敗");
              } finally {
                setBusy(false);
              }
            }}
          >
            重新檢查
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !configDraft.guild_id}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await discordApi.syncAll();
                toast.success(`已排程同步 ${result.queued} 位成員`);
              } catch (error) {
                toast.error(error instanceof ApiError ? error.message : "同步失敗");
              } finally {
                setBusy(false);
              }
            }}
          >
            同步所有成員
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy || !configDraft.moderation_log_channel_id}
            onClick={async () => {
              setBusy(true);
              try {
                await discordApi.testMessage({
                  channel_id: configDraft.moderation_log_channel_id ?? "",
                  message: "HCCA Discord Bot 後台測試訊息",
                });
                toast.success("測試訊息已排程送出");
              } catch (error) {
                toast.error(error instanceof ApiError ? error.message : "測試訊息失敗");
              } finally {
                setBusy(false);
              }
            }}
          >
            測試記錄頻道
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">伺服器與頻道</h2>
        {discordFetchError && (
          <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
            {discordFetchError}。可先手動輸入 ID，確認 Bot Token 與伺服器權限後會自動出現選單。
          </p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>Discord 伺服器</span>
            {guildOptions.length > 0 ? (
              <select
                className="input w-full"
                value={configDraft.guild_id}
                onChange={(event) => selectGuild(event.target.value)}
              >
                <option value="">選擇伺服器</option>
                {guildOptions.map((guild) => (
                  <option key={guild.id} value={guild.id}>{guild.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="input w-full"
                placeholder="手動輸入 Guild ID"
                value={configDraft.guild_id}
                onChange={(event) =>
                  setConfigDraft((current) => ({ ...current, guild_id: event.target.value }))
                }
              />
            )}
          </label>
          <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>顯示名稱</span>
            <input
              className="input w-full"
              value={configDraft.name ?? ""}
              onChange={(event) =>
                setConfigDraft((current) => ({ ...current, name: event.target.value || null }))
              }
            />
          </label>
          {channelField("office_channel_id", "辦公通知頻道")}
          {channelField("security_alert_channel_id", "資安警報頻道")}
          {channelField("petition_entry_channel_id", "陳情入口頻道")}
          {channelField("petition_private_category_id", "陳情私密頻道分類")}
          {channelField("announcement_channel_id", "公告頻道")}
          {channelField("moderation_log_channel_id", "社群管理記錄頻道")}
          {channelField("welcome_channel_id", "歡迎頻道")}
          <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <input
              type="checkbox"
              checked={configDraft.petition_private_channel_enabled}
              onChange={(event) =>
                setConfigDraft((current) => ({
                  ...current,
                  petition_private_channel_enabled: event.target.checked,
                }))
              }
            />
            啟用陳情私密討論頻道
          </label>
          <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>管理員身分組</span>
            {roleOptions.length > 0 ? (
              <select
                className="input w-full"
                value={configDraft.admin_role_id ?? ""}
                onChange={(event) =>
                  setConfigDraft((current) => ({ ...current, admin_role_id: event.target.value || null }))
                }
              >
                <option value="">不設定</option>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="input w-full"
                placeholder="手動輸入 Role ID"
                value={configDraft.admin_role_id ?? ""}
                onChange={(event) =>
                  setConfigDraft((current) => ({ ...current, admin_role_id: event.target.value || null }))
                }
              />
            )}
          </label>
          <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>陳情幹部身分組</span>
            {roleOptions.length > 0 ? (
              <select
                className="input w-full"
                value={configDraft.petition_staff_role_id ?? ""}
                onChange={(event) =>
                  setConfigDraft((current) => ({
                    ...current,
                    petition_staff_role_id: event.target.value || null,
                  }))
                }
              >
                <option value="">不設定</option>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="input w-full"
                placeholder="手動輸入 Role ID"
                value={configDraft.petition_staff_role_id ?? ""}
                onChange={(event) =>
                  setConfigDraft((current) => ({
                    ...current,
                    petition_staff_role_id: event.target.value || null,
                  }))
                }
              />
            )}
          </label>
        </div>
        {loadingDiscordMeta && (
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            正在從 Discord 讀取頻道與身分組...
          </p>
        )}
        <button className="btn btn-primary mt-4" onClick={saveConfig} disabled={busy || !configDraft.guild_id}>
          儲存伺服器設定
        </button>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">職位 / 組織身分組同步</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          <label className="space-y-1 text-xs sm:col-span-1" style={{ color: "var(--text-muted)" }}>
            <span>類型</span>
            <select
              className="input w-full"
              value={mappingDraft.mapping_kind}
              onChange={(event) => setMappingKind(event.target.value as DiscordRoleMappingKind)}
            >
              <option value="position">職位</option>
              <option value="org">組織</option>
            </select>
          </label>
          <label className="space-y-1 text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>
            <span>{mappingDraft.mapping_kind === "position" ? "職位" : "組織"}</span>
            {mappingDraft.mapping_kind === "position" ? (
              <select
                className="input w-full"
                value={mappingDraft.position_id ?? ""}
                onChange={(event) =>
                  setMappingDraft((current) => ({ ...current, position_id: event.target.value || null }))
                }
              >
                <option value="">選擇職位</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>{position.name}</option>
                ))}
              </select>
            ) : (
              <select
                className="input w-full"
                value={mappingDraft.org_id ?? ""}
                onChange={(event) =>
                  setMappingDraft((current) => ({ ...current, org_id: event.target.value || null }))
                }
              >
                <option value="">選擇組織</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>
                ))}
              </select>
            )}
          </label>
          <label className="space-y-1 text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>
            <span>Discord Role ID</span>
            {roleOptions.length > 0 ? (
              <select
                className="input w-full"
                value={mappingDraft.role_id}
                onChange={(event) =>
                  setMappingDraft((current) => ({ ...current, role_id: event.target.value }))
                }
              >
                <option value="">選擇 Discord 身分組</option>
                {roleOptions.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="input w-full"
                placeholder="手動輸入 Role ID"
                value={mappingDraft.role_id}
                onChange={(event) =>
                  setMappingDraft((current) => ({ ...current, role_id: event.target.value }))
                }
              />
            )}
          </label>
        </div>
        <button className="btn btn-primary mt-4" onClick={createMapping} disabled={busy || !mappingDraft.guild_id || !mappingDraft.role_id}>
          新增映射
        </button>

        <div className="mt-5 overflow-hidden rounded border" style={{ borderColor: "var(--border)" }}>
          {mappings.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              尚未建立身分組映射。
            </p>
          ) : (
            <ul>
              {mappings.map((mapping) => (
                <li
                  key={mapping.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {mapping.mapping_kind === "position"
                        ? positionName[mapping.position_id ?? ""] ?? mapping.position_id
                        : orgName[mapping.org_id ?? ""] ?? mapping.org_id}
                    </p>
                    <p className="mt-1 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {roleName[mapping.role_id] ?? `role ${mapping.role_id}`} · guild {mapping.guild_id}
                      {mapping.mapping_kind === "org" && mapping.org_id ? ` · ${orgName[mapping.org_id] ?? ""}` : ""}
                      {mapping.mapping_kind === "position" && mapping.position_id ? ` · ${positionName[mapping.position_id] ?? ""}` : ""}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy || !mapping.is_active}
                    onClick={() => disableMapping(mapping.id)}
                  >
                    {mapping.is_active ? "停用" : "已停用"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">社群暱稱前綴</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          依職位或組織自動套用前綴，會保留成員原本自訂暱稱。優先序數字越小越優先：行政 10、司法 20、學代 30、立法 40。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-6">
          <label className="space-y-1 text-xs sm:col-span-1" style={{ color: "var(--text-muted)" }}>
            <span>類型</span>
            <select
              className="input w-full"
              value={nicknameDraft.mapping_kind}
              onChange={(event) =>
                setNicknameDraft((current) => ({
                  ...current,
                  mapping_kind: event.target.value as DiscordRoleMappingKind,
                  org_id: event.target.value === "org" ? current.org_id : null,
                  position_id: event.target.value === "position" ? current.position_id : null,
                }))
              }
            >
              <option value="position">職位</option>
              <option value="org">組織</option>
            </select>
          </label>
          <label className="space-y-1 text-xs sm:col-span-2" style={{ color: "var(--text-muted)" }}>
            <span>{nicknameDraft.mapping_kind === "position" ? "職位" : "組織"}</span>
            {nicknameDraft.mapping_kind === "position" ? (
              <select
                className="input w-full"
                value={nicknameDraft.position_id ?? ""}
                onChange={(event) =>
                  setNicknameDraft((current) => ({ ...current, position_id: event.target.value || null }))
                }
              >
                <option value="">選擇職位</option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>{position.name}</option>
                ))}
              </select>
            ) : (
              <select
                className="input w-full"
                value={nicknameDraft.org_id ?? ""}
                onChange={(event) =>
                  setNicknameDraft((current) => ({ ...current, org_id: event.target.value || null }))
                }
              >
                <option value="">選擇組織</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>
                ))}
              </select>
            )}
          </label>
          <label className="space-y-1 text-xs sm:col-span-1" style={{ color: "var(--text-muted)" }}>
            <span>前綴</span>
            <input
              className="input w-full"
              value={nicknameDraft.prefix}
              placeholder="【主席】"
              onChange={(event) =>
                setNicknameDraft((current) => ({ ...current, prefix: event.target.value }))
              }
            />
          </label>
          <label className="space-y-1 text-xs sm:col-span-1" style={{ color: "var(--text-muted)" }}>
            <span>優先序</span>
            <select
              className="input w-full"
              value={nicknameDraft.priority}
              onChange={(event) =>
                setNicknameDraft((current) => ({ ...current, priority: Number(event.target.value) }))
              }
            >
              <option value={10}>行政</option>
              <option value={20}>司法</option>
              <option value={30}>學代</option>
              <option value={40}>立法</option>
              <option value={100}>其他</option>
            </select>
          </label>
          <div className="flex items-end sm:col-span-1">
            <button
              className="btn btn-primary w-full"
              onClick={createNicknameRule}
              disabled={
                busy ||
                !nicknameDraft.guild_id ||
                !nicknameDraft.prefix ||
                (nicknameDraft.mapping_kind === "position" && !nicknameDraft.position_id) ||
                (nicknameDraft.mapping_kind === "org" && !nicknameDraft.org_id)
              }
            >
              新增規則
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded border" style={{ borderColor: "var(--border)" }}>
          {nicknameRules.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              尚未建立暱稱前綴規則。
            </p>
          ) : (
            <ul>
              {nicknameRules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {rule.prefix}{" "}
                      {rule.mapping_kind === "position"
                        ? positionName[rule.position_id ?? ""] ?? rule.position_id
                        : orgName[rule.org_id ?? ""] ?? rule.org_id}
                    </p>
                    <p className="mt-1 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      priority {rule.priority} · guild {rule.guild_id}
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy || !rule.is_active}
                    onClick={() => disableNicknameRule(rule.id)}
                  >
                    {rule.is_active ? "停用" : "已停用"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold">機關公告頻道</h2>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          公開公文核准、公告發布後，會依機關自動送到這裡設定的 Discord 頻道。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>機關</span>
            <select
              className="input w-full"
              value={orgChannelDraft.org_id}
              onChange={(event) =>
                setOrgChannelDraft((current) => ({ ...current, org_id: event.target.value }))
              }
            >
              <option value="">選擇機關</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>{orgDisplayName(org, orgs)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs" style={{ color: "var(--text-muted)" }}>
            <span>Discord 公告頻道</span>
            {channelOptions.length > 0 ? (
              <select
                className="input w-full"
                value={orgChannelDraft.channel_id}
                onChange={(event) =>
                  setOrgChannelDraft((current) => ({ ...current, channel_id: event.target.value }))
                }
              >
                <option value="">選擇頻道</option>
                {channelOptions.map((channel) => (
                  <option key={channel.id} value={channel.id}>#{channel.name}</option>
                ))}
              </select>
            ) : (
              <input
                className="input w-full"
                placeholder="手動輸入頻道 ID"
                value={orgChannelDraft.channel_id}
                onChange={(event) =>
                  setOrgChannelDraft((current) => ({ ...current, channel_id: event.target.value }))
                }
              />
            )}
          </label>
        </div>
        <button
          className="btn btn-primary mt-4"
          onClick={saveOrgChannelMapping}
          disabled={
            busy ||
            !orgChannelDraft.guild_id ||
            !orgChannelDraft.org_id ||
            !orgChannelDraft.channel_id
          }
        >
          儲存機關頻道
        </button>

        <div className="mt-5 overflow-hidden rounded border" style={{ borderColor: "var(--border)" }}>
          {orgChannelMappings.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              尚未設定機關公告頻道。
            </p>
          ) : (
            <ul>
              {orgChannelMappings.map((mapping) => {
                const channel = channelOptions.find((item) => item.id === mapping.channel_id);
                return (
                  <li
                    key={mapping.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {orgName[mapping.org_id] ?? mapping.org_id}
                      </p>
                      <p className="mt-1 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {channel ? `#${channel.name}` : `channel ${mapping.channel_id}`} · guild {mapping.guild_id}
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busy || !mapping.is_active}
                      onClick={() => disableOrgChannelMapping(mapping.id)}
                    >
                      {mapping.is_active ? "停用" : "已停用"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
