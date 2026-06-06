/**
 * 將站台自訂 CSS 中和後才可注入 <style dangerouslySetInnerHTML>。
 *
 * 風險：custom_css 由具 SITE_MANAGE 權限者（未必是 superuser）設定，會原樣塞進
 * <style> 標籤。HTML 解析器只會在字面序列 `</style` 處結束 <style> 元素，因此只要
 * 含有 `</style><script>…` 之類片段就能突破成全站儲存型 XSS——目前僅靠 CSP 擋住，
 * 屬「安全完全押在 CSP 不回歸」的脆弱狀態。
 *
 * 合法 CSS 從不需要 `<` 字元（子選擇器用的是 `>`，需保留），故移除所有 `<` 即可
 * 徹底封死 `</style>` 突破，同時不影響正常樣式。另外移除 NUL 以防解析器怪異行為。
 */
export function sanitizeCustomCss(css: string | null | undefined): string {
  if (!css) return "";
  const NUL = String.fromCharCode(0);
  return css.split("<").join("").split(NUL).join("");
}
