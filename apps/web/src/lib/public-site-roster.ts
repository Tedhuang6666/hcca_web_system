/** 班級幹部名單與導覽資料的純解析／序列化。 */

export function parseJsonObject(value: string, label: string) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必須是 JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export type OfficerRosterLine = {
  lineNumber: number;
  title: string;
  names: string[];
  error?: string;
};

export type OfficerRosterEntry = {
  title: string;
  names: string[];
  member_labels?: Record<string, string>;
  highlight_label?: string;
  is_lead?: boolean;
};

export type OfficerRosterTab = {
  id: string;
  label: string;
  entries: OfficerRosterEntry[];
};

export function parseOfficerRoster(value: string): OfficerRosterLine[] {
  return value.split(/\r?\n/).flatMap((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return [];
    const separatorIndex = line.search(/[｜|：:]/);
    if (separatorIndex < 0) {
      return [{ lineNumber: index + 1, title: "", names: [], error: "請使用「職位｜姓名」格式（也支援冒號）" }];
    }
    const title = line.slice(0, separatorIndex).trim();
    const names = line
      .slice(separatorIndex + 1)
      .trim()
      .split(/[\s、，,]+/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!title || names.length === 0) {
      return [{ lineNumber: index + 1, title, names, error: "職位與姓名都不能空白" }];
    }
    return [{ lineNumber: index + 1, title, names: [...new Set(names)] }];
  });
}

export function parseStoredMemberLabels(value: unknown, names: string[], legacyLabel?: string) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([name, label]) => (
        typeof label === "string" && names.includes(name) && label.trim()
          ? [[name, label.trim()]]
          : []
      )),
    );
  }
  return legacyLabel && names[0] ? { [names[0]]: legacyLabel } : undefined;
}

export function parseStoredOfficerRoster(value: unknown): OfficerRosterEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const names = Array.isArray(record.names)
      ? record.names.filter((name): name is string => typeof name === "string").map((name) => name.trim()).filter(Boolean)
      : [];
    const highlightLabel = Object.prototype.hasOwnProperty.call(record, "highlight_label")
      ? (typeof record.highlight_label === "string" ? record.highlight_label.trim() : "")
      : undefined;
    const isLead = typeof record.is_lead === "boolean" ? record.is_lead : undefined;
    const memberLabels = parseStoredMemberLabels(record.member_labels, names, highlightLabel);
    return title && names.length > 0
      ? [{ title, names: [...new Set(names)], member_labels: memberLabels, highlight_label: highlightLabel, is_lead: isLead }]
      : [];
  });
}

export function parseStoredOfficerRosterTabs(themeConfig: Record<string, unknown> | undefined): OfficerRosterTab[] {
  if (Array.isArray(themeConfig?.officer_rosters)) {
    const tabs = themeConfig.officer_rosters.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const entries = parseStoredOfficerRoster(record.entries);
      return id && label ? [{ id, label, entries }] : [];
    });
    if (tabs.length > 0) return tabs;
  }
  return [{ id: "campus-council", label: "班聯會", entries: parseStoredOfficerRoster(themeConfig?.officer_roster) }];
}

export function serializeOfficerRoster(entries: OfficerRosterEntry[]) {
  return entries.map((entry) => `${entry.title}｜${entry.names.join(" ")}`).join("\n");
}

export function rosterMemberKey(tabId: string, title: string, name: string) {
  return `${tabId}::${title.trim()}::${name.trim()}`;
}

export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
