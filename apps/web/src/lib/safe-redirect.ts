/**
 * 回傳安全的「站內相對路徑」重導目標，否則回退 fallback。
 *
 * 防止 Open Redirect (CWE-601)。拒絕所有可能逃逸出本站來源的形式：
 *  - 絕對網址（`https://evil.com`、缺少前導 `/`）
 *  - 協定相對 `//host`（含 `/%2f`、`/%09` 等編碼變體）
 *  - 反斜線變體 `/\host`（瀏覽器正規化後等同 `//`）
 *  - 任何 ASCII 控制字元（`\x00–\x1f`）——瀏覽器去除後可能形成繞過
 *  - 路徑長度超過 2000 字元（防 URL bombing）
 *
 * 用於任何把使用者可控值交給 `window.location` / `router.push` 之前。
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  // 正規化 Unicode 以防全形斜線（U+FF0F ／）、數學除法符號（U+2215 ∕）等繞過
  const normalized = value.normalize("NFKC");
  if (!normalized.startsWith("/")) return fallback;
  const lowered = normalized.toLowerCase();
  // 封鎖 protocol-relative 及反斜線變體（含各種 URL 編碼）
  if (
    lowered.startsWith("//") ||
    lowered.startsWith("/\\") ||
    lowered.startsWith("/%2f") ||   // //
    lowered.startsWith("/%5c") ||   // /\
    lowered.startsWith("/%09") ||   // tab
    lowered.startsWith("/%0d") ||   // \r
    lowered.startsWith("/%0a")      // \n
  ) {
    return fallback;
  }
  // 封鎖所有 ASCII 控制字元（含 NUL、\r、\n、\t、ESC 等）及反斜線
  if (/[\x00-\x1f\x7f\\]/.test(normalized)) return fallback;
  // 長度上限防 URL bombing
  if (normalized.length > 2000) return fallback;
  // 回傳已 NFKC 正規化的路徑（確保一致性）
  return normalized;
}
