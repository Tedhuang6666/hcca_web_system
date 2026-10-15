import type { DocumentCategory } from "@/lib/types";

export function buildDocumentAutoTitle(
  category: DocumentCategory,
  issuer: string,
  docType: string,
): string {
  if (category === "decree") {
    const decreeIssuer = issuer.replace(/^國立新竹高級中學/, "新竹高中");
    return decreeIssuer ? `${decreeIssuer}主席令` : "主席令";
  }

  return [issuer, docType.trim()].filter(Boolean).join("").replace(/\s+/g, "");
}
