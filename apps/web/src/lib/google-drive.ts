const DOCS_KINDS = new Set(["document", "spreadsheets", "presentation", "forms"]);

/** 是否為 Google 雲端硬碟／文件連結（只看 host，用於顯示標記）。 */
export function isGoogleDriveUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const { protocol, hostname } = new URL(raw);
    return protocol === "https:" && (hostname === "docs.google.com" || hostname === "drive.google.com");
  } catch {
    return false;
  }
}

/**
 * 把分享連結轉成可內嵌的 /preview 網址；只接受已知的 Google 路徑格式，其他一律回傳 null，
 * 避免把任意網址放進 iframe。
 */
export function googleDrivePreviewUrl(raw: string | null | undefined): string | null {
  if (!isGoogleDriveUrl(raw)) return null;
  const url = new URL(raw as string);
  const parts = url.pathname.split("/").filter(Boolean);
  const idPattern = /^[A-Za-z0-9_-]{10,}$/;
  if (url.hostname === "docs.google.com") {
    const [kind, d, id] = parts;
    if (!DOCS_KINDS.has(kind) || d !== "d" || !idPattern.test(id ?? "")) return null;
    // 表單用 viewform 內嵌，其餘用 preview。
    return kind === "forms"
      ? `https://docs.google.com/forms/d/${id}/viewform?embedded=true`
      : `https://docs.google.com/${kind}/d/${id}/preview`;
  }
  if (parts[0] === "file" && parts[1] === "d" && idPattern.test(parts[2] ?? "")) {
    return `https://drive.google.com/file/d/${parts[2]}/preview`;
  }
  if (parts[0] === "drive" && parts[1] === "folders" && idPattern.test(parts[2] ?? "")) {
    return `https://drive.google.com/embeddedfolderview?id=${parts[2]}#list`;
  }
  return null;
}
