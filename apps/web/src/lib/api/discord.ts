import type {
  DiscordBindingOut, DiscordBotHealthOut, DiscordChannelOptionOut, DiscordGuildConfigIn, DiscordGuildConfigOut, DiscordGuildOptionOut, DiscordMemberSyncStateOut, DiscordNicknamePrefixRuleIn, DiscordNicknamePrefixRuleOut, DiscordOrgChannelMappingIn, DiscordOrgChannelMappingOut, DiscordRoleMappingIn, DiscordRoleMappingOut, DiscordRoleOptionOut, DiscordRolePolicyIn, DiscordRolePolicyOut, DiscordSyncAllOut,
} from "../types";
import { BASE, get, post, patch, del } from "./core";

export const discordApi = {
  me: () => get<DiscordBindingOut>("/discord/me"),
  loginUrl: (next = "/dashboard") => `${BASE}/discord/login?next=${encodeURIComponent(next)}`,
  unlink: () => del<void>("/discord/me"),
  syncMe: () => post<void>("/discord/me/sync", {}),
  health: () => get<DiscordBotHealthOut>("/discord/health"),
  syncAll: () => post<DiscordSyncAllOut>("/discord/sync-all", {}),
  testMessage: (body: { channel_id: string; message?: string }) =>
    post<void>("/discord/test-message", body),
  availableGuilds: () => get<DiscordGuildOptionOut[]>("/discord/available-guilds"),
  guildChannels: (guildId: string) =>
    get<DiscordChannelOptionOut[]>(`/discord/guilds/${encodeURIComponent(guildId)}/channels`),
  guildRoles: (guildId: string) =>
    get<DiscordRoleOptionOut[]>(`/discord/guilds/${encodeURIComponent(guildId)}/roles`),
  listGuildConfigs: () => get<DiscordGuildConfigOut[]>("/discord/guild-configs"),
  saveGuildConfig: (body: DiscordGuildConfigIn) =>
    post<DiscordGuildConfigOut>("/discord/guild-configs", body),
  listOrgChannelMappings: () =>
    get<DiscordOrgChannelMappingOut[]>("/discord/org-channel-mappings"),
  saveOrgChannelMapping: (body: DiscordOrgChannelMappingIn) =>
    post<DiscordOrgChannelMappingOut>("/discord/org-channel-mappings", body),
  deleteOrgChannelMapping: (id: string) => del<void>(`/discord/org-channel-mappings/${id}`),
  listNicknamePrefixRules: () =>
    get<DiscordNicknamePrefixRuleOut[]>("/discord/nickname-prefix-rules"),
  createNicknamePrefixRule: (body: DiscordNicknamePrefixRuleIn) =>
    post<DiscordNicknamePrefixRuleOut>("/discord/nickname-prefix-rules", body),
  updateNicknamePrefixRule: (id: string, body: DiscordNicknamePrefixRuleIn) =>
    patch<DiscordNicknamePrefixRuleOut>(`/discord/nickname-prefix-rules/${id}`, body),
  deleteNicknamePrefixRule: (id: string) => del<void>(`/discord/nickname-prefix-rules/${id}`),
  listRoleMappings: () => get<DiscordRoleMappingOut[]>("/discord/role-mappings"),
  createRoleMapping: (body: DiscordRoleMappingIn) =>
    post<DiscordRoleMappingOut>("/discord/role-mappings", body),
  updateRoleMapping: (id: string, body: DiscordRoleMappingIn) =>
    patch<DiscordRoleMappingOut>(`/discord/role-mappings/${id}`, body),
  deleteRoleMapping: (id: string) => del<void>(`/discord/role-mappings/${id}`),
  listRolePolicies: (guildId?: string) =>
    get<DiscordRolePolicyOut[]>(
      `/discord/role-policies${guildId ? `?guild_id=${encodeURIComponent(guildId)}` : ""}`,
    ),
  createRolePolicy: (body: DiscordRolePolicyIn) =>
    post<DiscordRolePolicyOut>("/discord/role-policies", body),
  updateRolePolicy: (id: string, body: DiscordRolePolicyIn) =>
    patch<DiscordRolePolicyOut>(`/discord/role-policies/${id}`, body),
  deleteRolePolicy: (id: string) => del<void>(`/discord/role-policies/${id}`),
  memberSyncStates: (guildId?: string, driftOnly = false) => {
    const q = new URLSearchParams();
    if (guildId) q.set("guild_id", guildId);
    if (driftOnly) q.set("drift_only", "true");
    return get<DiscordMemberSyncStateOut[]>(`/discord/member-sync-states?${q.toString()}`);
  },
  repairMemberSyncState: (id: string) =>
    post<void>(`/discord/member-sync-states/${id}/repair`, {}),
  repairMemberSyncStates: (stateIds: string[] = []) =>
    post<{ queued: number }>("/discord/member-sync-states/repair", {
      state_ids: stateIds,
      drift_only: true,
    }),
};
