import { describe, expect, it } from "vitest";

import { DEFAULT_SPECIAL_AGREEMENT_CONTENT, readSpecialAgreementContent } from "./specialAgreement";

describe("readSpecialAgreementContent", () => {
  it("keeps editable custom content and reference files", () => {
    const content = readSpecialAgreementContent({
      intro_md: " 自訂介紹 ",
      info_md: "自訂資訊",
      process: [{ id: "step-1", title: "流程", description: "說明" }],
      files: [{ id: "guide", title: "指南", description: "PDF", url: "/uploads/guide.pdf", mimeType: "application/pdf" }],
    });

    expect(content.intro_md).toBe(" 自訂介紹 ");
    expect(content.process).toEqual([{ id: "step-1", title: "流程", description: "說明" }]);
    expect(content.files).toEqual([
      { id: "guide", title: "指南", description: "PDF", url: "/uploads/guide.pdf", mimeType: "application/pdf" },
    ]);
  });

  it("allows an explicitly empty file list", () => {
    const content = readSpecialAgreementContent({ files: [] });

    expect(content.files).toEqual([]);
    expect(content.files).not.toEqual(DEFAULT_SPECIAL_AGREEMENT_CONTENT.files);
  });
});
