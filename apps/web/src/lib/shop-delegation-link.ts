const PENDING_DELEGATION_KEY = "hcca:shop:pending-delegation";

/** 清除錯誤／導覽追蹤裡的分享密鑰，保留既有事件形狀與其他資料。 */
export function redactShopDelegationSecrets<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const redact = (node: unknown): unknown => {
    if (typeof node === "string") {
      return node.replace(/([#&]delegate=|%23delegate%3D|%26delegate%3D)[A-Za-z0-9_-]+/gi, "$1[redacted]");
    }
    if (!node || typeof node !== "object") return node;
    if (seen.has(node)) return seen.get(node);
    if (Array.isArray(node)) {
      const result: unknown[] = [];
      seen.set(node, result);
      for (const child of node) result.push(redact(child));
      return result;
    }
    if (Object.getPrototypeOf(node) !== Object.prototype) return node;
    const result: Record<string, unknown> = {};
    seen.set(node, result);
    for (const [key, child] of Object.entries(node)) result[key] = redact(child);
    return result;
  };
  return redact(value) as T;
}

/** 分頁內接續登入；密鑰不放進登入／OAuth 的 next query。權限仍由 API 驗證。 */
export function shopDelegationLoginNext(token: string): string {
  try {
    window.sessionStorage.setItem(PENDING_DELEGATION_KEY, token);
  } catch {
    // 登入後顯示重新開啟分享連結，不退回本人登記模式。
  }
  return "/shop?delegation=resume";
}

export function readShopDelegationToken(): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  let pending: string | null = null;
  try {
    pending = window.sessionStorage.getItem(PENDING_DELEGATION_KEY);
    window.sessionStorage.removeItem(PENDING_DELEGATION_KEY);
  } catch {
    // 瀏覽器不提供 storage 時，原始分享連結仍可直接使用。
  }
  if (fragment.has("delegate")) return fragment.get("delegate") || "invalid";
  if (query.get("delegation") !== "resume") return null;
  if (!pending) return "invalid";
  query.delete("delegation");
  const search = query.toString();
  window.history.replaceState(window.history.state, "",
    `/shop${search ? `?${search}` : ""}#delegate=${encodeURIComponent(pending)}`);
  return pending;
}
