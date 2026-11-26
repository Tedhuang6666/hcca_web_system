import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { OrderPurchaseDetailRow } from "@/lib/types";
import { classOrderPages, createClassOrderDocument } from "./class-order-document";

const item: OrderPurchaseDetailRow = {
  class_id: "a", class_label: "101", grade: 1, class_code: "101", seat_number: 5,
  user_id: "one", buyer_label: "王同學", product_id: "shirt", product_name: "衣服 & 帽子",
  variant_key: "尺寸：L", quantity: 2, order_count: 1,
};

describe("班級訂購明細", () => {
  it("依班級與帳號分組並按座號排列，產生可開啟的 Word 文件", () => {
    const pages = classOrderPages([
      item,
      { ...item, product_id: "bag", product_name: "袋子", variant_key: "—", quantity: 1 },
      { ...item, user_id: "two", buyer_label: "同名學生", seat_number: 2 },
      { ...item, class_id: "b", class_label: "102", seat_number: null },
    ]);
    expect(pages).toHaveLength(2);
    expect(pages[0].buyers.map((buyer) => buyer.seat)).toEqual([2, 5]);
    expect(pages[0].buyers[1].items).toEqual(["衣服 & 帽子（尺寸：L） × 2", "袋子 × 1"]);
    expect(pages[1].buyers[0].seat).toBeNull();
    const archive = unzipSync(createClassOrderDocument(pages, "校慶"));
    expect(Object.keys(archive)).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    expect(archive["_rels/.rels"]).toBeDefined();
    const document = strFromU8(archive["word/document.xml"]);
    expect(document).toContain("校慶 數量明細 - 101");
    expect(document).toContain("衣服 &amp; 帽子");
    expect(document).toContain('w:type="page"');
    expect(document).toContain("座號");
  });
});
