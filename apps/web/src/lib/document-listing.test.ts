import { describe, expect, it } from "vitest";
import { documentListing } from "./document-listing";

describe("公文主旨與內容摘要", () => {
  it("忠實顯示主旨，摘要不得覆蓋原主旨", () => {
    expect(documentListing({ subject: "原始主旨", summary: "人工摘要" }))
      .toEqual({ text: "原始主旨", isSummary: false });
  });
  it("無主旨才使用有標記的摘要，缺值不退回文件標題", () => {
    expect(documentListing({ subject: "  ", summary: "令文摘要" }))
      .toEqual({ text: "令文摘要", isSummary: true });
    expect(documentListing({ subject: null, summary: null }))
      .toEqual({ text: "主旨未載明", isSummary: false });
  });
});
