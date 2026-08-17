export type NavigationProfile = "default" | "student" | "teacher" | "vendor" | "mealVendor";

export const NAVIGATION_PROFILE_RULES = {
  mealVendor: {
    matchAnyPrefixes: ["meal:"],
    matchAnyPermissions: [] as string[],
    excludePrefixes: [
      "document:",
      "regulation:",
      "admin:",
      "shop:",
      "finance:",
      "org:",
      "petition:",
      "election:",
    ],
  },
  vendor: {
    matchAnyPrefixes: ["partner_map:", "electronic_credential:"],
    matchAnyPermissions: [] as string[],
    excludePrefixes: [] as string[],
  },
  teacher: {
    matchAnyPrefixes: ["class:", "exam:"],
    matchAnyPermissions: ["survey:review", "survey:manage"],
    excludePrefixes: [] as string[],
  },
};

export function resolveNavigationProfile(
  permissions: Set<string>,
  isAdmin: boolean,
): NavigationProfile {
  if (isAdmin || permissions.has("admin:all")) return "default";
  const hasPrefix = (prefix: string) => Array.from(permissions).some((p) => p.startsWith(prefix));
  const hasNonViewerPermission = (prefix: string, viewerOnly: string[]) =>
    Array.from(permissions).some((permission) =>
      permission.startsWith(prefix) && !viewerOnly.includes(permission),
    );
  const hasGovernanceOrBackoffice = [
    hasNonViewerPermission("document:", ["document:view_all"]),
    hasNonViewerPermission("regulation:", ["regulation:view_all"]),
    "admin:",
    "org:",
    "finance:",
    "election:",
    "audit:",
    "email:",
    "merchandise_submission:",
    "shop:",
    "electronic_credential:",
  ].some((entry) => typeof entry === "string" ? hasPrefix(entry) : entry);

  if (hasGovernanceOrBackoffice) return "default";

  for (const id of ["mealVendor", "vendor", "teacher"] as const) {
    const profile = NAVIGATION_PROFILE_RULES[id];
    const matchedPrefix = profile.matchAnyPrefixes.some(hasPrefix);
    const matchedPermission = profile.matchAnyPermissions.some((code) => permissions.has(code));
    const excluded = profile.excludePrefixes.some(hasPrefix);
    if ((matchedPrefix || matchedPermission) && !excluded) return id;
  }

  return "student";
}
