/**
 * 回傳安全的「站內相對路徑」重導目標，否則回退 fallback。
 *
 * 防止 Open Redirect (CWE-601)。拒絕所有可能逃逸出本站來源的形式：
 *  - 絕對網址（`https://evil.com`、缺少前導 `/`）
 *  - 協定相對 `//host`
 *  - 反斜線變體 `/\host`（瀏覽器會把 `\` 正規化成 `/`）
 *  - 上述的百分比編碼（`/%2f`、`/%5c`）
 *  - 內嵌控制字元 / 空白（`\r \n \t` 空格）——瀏覽器去除後可能形成繞過
 *
 * 用於任何把使用者可控值交給 `window.location` / `router.push` 之前。
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/")) return fallback;
  const lowered = value.toLowerCase();
  if (
    lowered.startsWith("//") ||
    lowered.startsWith("/\\") ||
    lowered.startsWith("/%2f") ||
    lowered.startsWith("/%5c")
  ) {
    return fallback;
  }
  if (/[\\\r\n\t ]/.test(value)) return fallback;
  return value;
}
