import type { ClassRoleOut, SchoolClassListItem, SchoolClassOut } from "@/lib/types";

export function roleHolderSummary(role: ClassRoleOut) {
  return [
    ...role.holders.map((holder) => holder.display_name),
    ...(role.person_holders ?? []).map((holder) => `${holder.display_name}${holder.status === "pending_user" ? "（待註冊）" : ""}`),
  ].join("、");
}

export function classTitle(c: SchoolClassListItem | SchoolClassOut | null) {
  if (!c) return "未選擇班級";
  return c.label || `${c.academic_year} 學年度 ${c.class_code} 班`;
}
