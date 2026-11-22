import type { SubmissionCustomField } from "@/lib/types";

export function isPreviewableImage(file: { content_type: string; filename: string }) {
  return (
    file.content_type.startsWith("image/") ||
    /\.(jpe?g|png|webp)$/i.test(file.filename)
  );
}

export function formatScanTime(value: string | null) {
  if (!value) return "尚未掃描";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });
}

export function mergeFields(
  globalFields: SubmissionCustomField[],
  itemFields: SubmissionCustomField[],
): SubmissionCustomField[] {
  const fields = new Map(globalFields.map((field) => [field.key, field]));
  for (const field of itemFields) fields.set(field.key, field);
  return [...fields.values()];
}

export function toLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
