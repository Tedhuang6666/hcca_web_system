/**
 * 全站唯一的剪貼簿寫入。
 * 優先用 Clipboard API；舊瀏覽器或非安全來源（例如區網 http）退回選取隱藏文字框複製。
 * 失敗時丟出錯誤，由呼叫端決定如何讓使用者手動複製。
 */
export async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("copy_failed");
  } finally {
    textarea.remove();
  }
}
