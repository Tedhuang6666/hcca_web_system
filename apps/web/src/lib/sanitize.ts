/**
 * 將站台自訂 CSS 中和後才可注入 <style dangerouslySetInnerHTML>。
 *
 * 移除項目：
 * - `<`                   → 封死 </style><script> 突破
 * - `@import`             → 禁止載入外部樣式表（CSS exfiltration / SSRF）
 * - `url(`                → 禁止 url() 參照外部資源（背景圖外洩、SSRF）
 * - `expression(`         → 封死 IE CSS expression
 * - `behavior:`           → 封死 IE behavior HTC
 * - `-moz-binding:`       → 封死舊版 Firefox XML binding
 * - `javascript:`         → 封死 CSS 屬性值 javascript: URI
 * - `@charset`            → 封死編碼宣告繞過
 * - CSS unicode escape    → `\nn` 形式繞過過濾器
 * - NUL（\x00）           → 防解析器怪異行為
 * - `-webkit-mask*`       → WebKit mask-image 可參照外部資源（等同 url() 外洩）
 * - `mask-image`          → 標準 CSS mask，同上
 * - `attr(`               → CSS attr() 可用於資料外洩（搭配 content: attr(data-*)）
 * - `@property`           → CSS Houdini 自訂屬性，部分瀏覽器允許 type/inherits 執行副作用
 * - `content\s*:`         → ::before/::after content 可外洩 DOM attribute 值
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
    .replace(/@property\b/gi, "/* @property blocked */")
    .replace(/\burl\s*\(/gi, "/* url( blocked */")
    .replace(/\bexpression\s*\(/gi, "/* expression( blocked */")
    .replace(/\battr\s*\(/gi, "/* attr( blocked */")
    .replace(/\bbehavior\s*:/gi, "/* behavior blocked */")
    .replace(/-moz-binding\s*:/gi, "/* -moz-binding blocked */")
    .replace(/-webkit-mask\b/gi, "/* -webkit-mask blocked */")
    .replace(/\bmask-image\s*:/gi, "/* mask-image blocked */")
    .replace(/\bmask-source\s*:/gi, "/* mask-source blocked */")
    .replace(/\bcontent\s*:/gi, "/* content blocked */")
    .replace(/javascript\s*:/gi, "/* javascript: blocked */");
}
