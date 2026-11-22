/** 組織顯示所需的最小欄位 */
type OrgLike = { id: string; name: string; parent_id?: string | null };

/**
 * 回傳含上級機關的組織顯示名稱，例如「教育部 · 秘書處」。
 *
 * 同名單位（如「秘書處」）常掛在多個上級機關之下，只顯示組織本名無法辨識，
 * 因此在扁平清單／下拉選單中一律帶出直屬上級機關。
 *
 * - 無上級（頂層機關）時只回傳組織本名。
 * - 上級不在傳入清單中（例如被 active_only 過濾）時退回只顯示本名，不會出錯。
 *
 * @param org   要顯示的組織（需含 parent_id）
 * @param orgs  可用來解析上級名稱的組織清單（通常為同一份載入的列表）
 */
export function orgDisplayName(org: OrgLike, orgs: readonly OrgLike[]): string {
  if (!org.parent_id) return org.name;
  const parent = orgs.find((o) => o.id === org.parent_id);
  return parent ? `${parent.name} · ${org.name}` : org.name;
}
