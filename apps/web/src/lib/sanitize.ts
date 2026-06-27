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
  let result = css.split("<").join("").split(NUL).join("");

  // 迴圈移除 CSS unicode escapes（\nn 形式），直到結果穩定後才套用阻擋規則。
  // 單次移除無法防止多層編碼繞過：ur\6C( 第一輪變 ur(，此時 url( 過濾已過執行，
  // 迴圈確保所有層次全部展開後才進入後續比對。
  let prev = "";
  while (prev !== result) {
    prev = result;
    result = result.replace(/\\[0-9a-fA-F]{1,6}\s?/g, "");
  }

  return result
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
