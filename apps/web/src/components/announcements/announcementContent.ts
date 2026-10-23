function textFromLegacyTiptap(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const record = node as { type?: unknown; text?: unknown; content?: unknown };
  const ownText = typeof record.text === "string" ? record.text : "";
  const children = Array.isArray(record.content)
    ? record.content.map(textFromLegacyTiptap).filter(Boolean)
    : [];
  if (!children.length) return ownText;
  const separator = record.type === "doc" || record.type === "paragraph" ? "\n" : "";
  return [ownText, ...children].filter(Boolean).join(separator);
}

export function markdownFromContent(content: Record<string, unknown> | null | undefined): string {
  if (!content) return "";
  const markdown = content.markdown;
  if (typeof markdown === "string") return markdown;
  const text = content.text;
  if (typeof text === "string") return text;
  return textFromLegacyTiptap(content);
}

export function contentFromMarkdown(markdown: string): Record<string, unknown> {
  return { format: "markdown", markdown };
}
