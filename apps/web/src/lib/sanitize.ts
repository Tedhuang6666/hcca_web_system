/**
 * 將站台自訂 CSS 中和後才可注入 <style dangerouslySetInnerHTML>。
 *
 * 移除項目：
 * - `<`                 → 封死 </style><script> 突破
 * - `@import`           → 禁止載入外部樣式表（CSS exfiltration / SSRF）
 * - `url(`              → 禁止 url() 參照外部資源（font-face exfiltration、背景圖追蹤）
 * - `expression(`       → 封死 IE CSS expression（現代瀏覽器不支援但防禦縱深）
 * - NUL（\x00）         → 防解析器怪異行為
 */
export function sanitizeCustomCss(css: string | null | undefined): string {
  if (!css) return "";
  const NUL = String.fromCharCode(0);
  return css
    .split("<").join("")
    .replace(/@import\b/gi, "/* @import blocked */")
    .replace(/\burl\s*\(/gi, "/* url( blocked */")
    .replace(/\bexpression\s*\(/gi, "/* expression( blocked */")
    .split(NUL).join("");
}
