import { describe, expect, it } from "vitest";

import { directRegulationPdfUrl } from "./regulation-pdf";

const CURRENT_CHARTER = {
  title: "國立新竹高級中學班級聯合自治會組織章程",
  is_active: true,
  is_repealed: false,
  workflow_status: "published" as const,
  published_at: "2026-06-17T05:30:42.600Z",
};

describe("directRegulationPdfUrl", () => {
  it("uses the public 114-2 Drive PDF for the current published charter", () => {
    expect(directRegulationPdfUrl(CURRENT_CHARTER)).toBe(
      "https://drive.google.com/uc?export=download&id=1GJlHJA81yF4q14Ak0XJZKFPFEt_VYbFi",
    );
  });

  it("does not replace generated PDFs for other or non-current regulations", () => {
    expect(directRegulationPdfUrl({ ...CURRENT_CHARTER, title: "其他法規" })).toBeNull();
    expect(directRegulationPdfUrl({ ...CURRENT_CHARTER, is_active: false })).toBeNull();
    expect(directRegulationPdfUrl({ ...CURRENT_CHARTER, is_repealed: true })).toBeNull();
    expect(directRegulationPdfUrl({ ...CURRENT_CHARTER, workflow_status: "archived" })).toBeNull();
    expect(directRegulationPdfUrl({ ...CURRENT_CHARTER, published_at: null })).toBeNull();
  });
});
