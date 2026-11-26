import { strToU8, zipSync } from "fflate";
import type { OrderPurchaseDetailRow } from "@/lib/types";

type Buyer = { key: string; name: string; seat: number | null; items: string[] };
export type ClassOrderPage = { key: string; label: string; buyers: Buyer[] };

export function classOrderPages(rows: OrderPurchaseDetailRow[]): ClassOrderPage[] {
  const classes = new Map<string, { label: string; buyers: Map<string, Buyer> }>();
  rows.forEach((row, index) => {
    const classKey = row.class_id ?? "unassigned";
    const group = classes.get(classKey) ?? { label: row.class_label, buyers: new Map<string, Buyer>() };
    // External orders lack a stable buyer identity; do not merge them by name.
    const buyerKey = row.user_id ?? `external-${index}`;
    const buyer: Buyer = group.buyers.get(buyerKey) ?? {
      key: buyerKey, name: row.buyer_label, seat: row.seat_number ?? null, items: [],
    };
    buyer.items.push(`${row.product_name}${row.variant_key === "—" ? "" : `（${row.variant_key}）`} × ${row.quantity}`);
    group.buyers.set(buyerKey, buyer);
    classes.set(classKey, group);
  });
  return Array.from(classes, ([key, group]) => ({
    key,
    label: group.label,
    buyers: Array.from(group.buyers.values()).sort((a, b) =>
      (a.seat ?? Infinity) - (b.seat ?? Infinity) || a.name.localeCompare(b.name, "zh-Hant")),
  }));
}

const utf8 = (value: string) => new Uint8Array(strToU8(value));
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const paragraph = (value: string) => `<w:p><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
const cell = (values: string[], width: number) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${values.map(paragraph).join("")}</w:tc>`;

export function createClassOrderDocument(pages: ClassOrderPage[], scope: string): Uint8Array {
  const content = pages.map((page, index) => {
    const title = `${scope} 數量明細 - ${page.label}`;
    const headings = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cell(["座號"], 1000)}${cell(["姓名"], 2000)}${cell(["訂購數量"], 6000)}</w:tr>`;
    const rows = page.buyers.map((buyer) => `<w:tr>${cell([buyer.seat == null ? "" : String(buyer.seat)], 1000)}${cell([buyer.name], 2000)}${cell(buyer.items, 6000)}</w:tr>`).join("");
    return `${index ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}${paragraph(title)}<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="000000"/>`).join("")}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="2000"/><w:gridCol w:w="6000"/></w:tblGrid>${headings}${rows}</w:tbl>`;
  }).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": utf8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": utf8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": utf8(document),
  });
}
