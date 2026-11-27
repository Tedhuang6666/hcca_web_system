import { getSystemInfoMarkdown } from "./systemInfoMarkdown";
import type { PublicSiteSettingsOut } from "./types";

export function normalizeSettingsForEditor(settings: PublicSiteSettingsOut): PublicSiteSettingsOut {
  return { ...settings, system_info_md: getSystemInfoMarkdown(settings) };
}

/** 各分頁只儲存自己的欄位；回填伺服器結果時保留其他分頁尚未儲存的修改。 */
export function mergeSavedSettings(
  current: PublicSiteSettingsOut,
  saved: PublicSiteSettingsOut,
  keys: string[],
): PublicSiteSettingsOut {
  const normalized = normalizeSettingsForEditor(saved);
  const merged: Record<string, unknown> = { ...current };
  for (const key of keys) merged[key] = normalized[key as keyof PublicSiteSettingsOut];
  return merged as PublicSiteSettingsOut;
}
