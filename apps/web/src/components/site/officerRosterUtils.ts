export function isLeadershipTitle(title: string): boolean {
  return /(?:長|主席|召集人)$/.test(title.trim());
}

export function getMemberLeadershipLabel(
  title: string,
  name: string,
  memberLabels?: Record<string, string>,
  legacyRoleLabel?: string,
  legacyLead = false,
): string {
  if (memberLabels !== undefined) return memberLabels[name]?.trim() ?? "";
  if (legacyRoleLabel !== undefined) return legacyRoleLabel.trim();
  if (legacyLead || isLeadershipTitle(title)) return "長級";
  return "";
}
