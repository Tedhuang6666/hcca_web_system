import type { PublicSiteSettingsOut } from "@/lib/types";

const LEGACY_SECTIONS = [
  ["需要協助嗎？", "support_md"],
  ["錯誤報告", "error_report_md"],
  ["聯絡資訊", "contact_md"],
  ["使用者條款", "terms_md"],
  ["開發團隊", "developer_team_md"],
] as const;

export function getSystemInfoMarkdown(settings: PublicSiteSettingsOut): string {
  if (settings.system_info_md?.trim()) return settings.system_info_md;

  return LEGACY_SECTIONS
    .map(([title, key]) => {
      const content = settings[key]?.trim();
      return content ? `## ${title}\n\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
