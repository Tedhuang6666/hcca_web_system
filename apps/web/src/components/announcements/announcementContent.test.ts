import { describe, expect, it } from "vitest";
import { contentFromMarkdown, markdownFromContent } from "./announcementContent";

describe("announcement content compatibility", () => {
  it("round-trips Markdown without losing formatting or image metadata", () => {
    const markdown = "## 公告\n\n**內容**\n\n![說明|w=640](/uploads/example.png)";
    expect(markdownFromContent(contentFromMarkdown(markdown))).toBe(markdown);
  });

  it("preserves older plain text and nested Tiptap announcements", () => {
    expect(markdownFromContent({ text: "舊公告" })).toBe("舊公告");
    expect(markdownFromContent({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
      { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
    ] })).toBe("第一段\n第二段");
    expect(markdownFromContent({ markdown: "", text: "不可取代空白內容" })).toBe("");
    expect(markdownFromContent(null)).toBe("");
  });
});
