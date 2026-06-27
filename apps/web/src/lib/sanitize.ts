/**
 * 將站台自訂 CSS 中和後才可注入 <style dangerouslySetInnerHTML>。
 *
 * 移除項目：
 * - `<`                 → 封死 </style><script> 突破
 * - `@import`           → 禁止載入外部樣式表（CSS exfiltration / SSRF）
 * - `url(`              → 禁止 url() 參照外部資源（font-face exfiltration、背景圖追蹤）
 * - `expression(`       → 封死 IE CSS expression（現代瀏覽器不支援但防禦縱深）
 * - `behavior:`         → 封死 IE behavior（可載入外部 HTC 執行任意 JS）
 * - `-moz-binding:`     → 封死舊版 Firefox XML binding（可執行 JS）
 * - `javascript:`       → 封死 CSS 屬性值中的 javascript: URI
 * - `@charset`          → 封死編碼宣告繞過（改變後續 CSS 解析行為）
 * - CSS unicode escape  → `\nn` 形式常被用來繞過字串比對過濾器
 * - NUL（\x00）         → 防解析器怪異行為
 */
export function sanitizeCustomCss(css: string | null | undefined): string {
  if (!css) return "";
  const NUL = String.fromCharCode(0);
  return css
    .split("<").join("")
    .split(NUL).join("")
    // 移除 CSS unicode escapes（\nn 形式）再做後續過濾，防止 \75 rl( 繞過 url( 過濾
    .replace(/\\[0-9a-fA-F]{1,6}\s?/g, "")
    .replace(/@import\b/gi, "/* @import blocked */")
    .replace(/@charset\b/gi, "/* @charset blocked */")
    .replace(/@supports\b/gi, "/* @supports blocked */")
    .replace(/\burl\s*\(/gi, "/* url( blocked */")
    .replace(/\bexpression\s*\(/gi, "/* expression( blocked */")
    .replace(/\bbehavior\s*:/gi, "/* behavior blocked */")
    .replace(/-moz-binding\s*:/gi, "/* -moz-binding blocked */")
    .replace(/javascript\s*:/gi, "/* javascript: blocked */");
}
