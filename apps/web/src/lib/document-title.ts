import type { DocumentCategory } from "@/lib/types";

const DECREE_AUTO_TITLE = "國立新竹高級中學班級聯合自治會主席令";

export function buildDocumentAutoTitle(
  category: DocumentCategory,
  issuer: string,
  docType: string,
): string {
  if (category === "decree") {
    return DECREE_AUTO_TITLE;
  }

  return [issuer, docType.trim()].filter(Boolean).join("").replace(/\s+/g, "");
}
