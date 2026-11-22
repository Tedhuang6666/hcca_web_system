import type { DocumentListItem } from "./types";

export function documentListing(document: Pick<DocumentListItem, "subject" | "summary">) {
  const subject = document.subject?.trim();
  if (subject) return { text: subject, isSummary: false };
  const summary = document.summary?.trim();
  return { text: summary || "主旨未載明", isSummary: Boolean(summary) };
}
