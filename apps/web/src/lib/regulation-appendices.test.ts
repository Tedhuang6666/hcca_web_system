import { describe, expect, it } from "vitest";
import type { RegulationArticleOut } from "./types";
import { regulationAppendices } from "./regulation-appendices";

describe("法規附錄入口", () => {
  it("相同引用合併，未收錄的附錄不建立原文連結", () => {
    const entries = regulationAppendices([], "依附錄（一）至附錄（四）辦理，附錄（一）另定。");
    expect(entries.map((entry) => entry.label)).toEqual(["附錄（一）", "附錄（四）"]);
    expect(entries.every((entry) => entry.articleId === null)).toBe(true);
  });
  it("只連結未刪除且已收錄內容的附錄節點", () => {
    const articles = [
      { id: "appendix-1", title: "附錄（一）　流程表", content: "正式附錄內容", is_deleted: false },
      { id: "appendix-2", title: "附錄（二）", content: "舊附錄", is_deleted: true },
    ] as RegulationArticleOut[];
    const entries = regulationAppendices(articles, "參見附錄(一)、附錄（二）。");
    expect(entries[0].articleId).toBe("appendix-1");
    expect(entries[1].articleId).toBeNull();
  });
});
