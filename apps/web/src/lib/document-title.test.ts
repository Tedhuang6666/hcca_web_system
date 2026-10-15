import { describe, expect, it } from "vitest";

import { buildDocumentAutoTitle } from "./document-title";

describe("buildDocumentAutoTitle", () => {
  it("uses the school short name for decree titles", () => {
    expect(
      buildDocumentAutoTitle("decree", "國立新竹高級中學主席班聯會", "令"),
    ).toBe("新竹高中主席班聯會主席令");
  });

  it("keeps the full issuer name for other document categories", () => {
    expect(
      buildDocumentAutoTitle("letter", "國立新竹高級中學主席班聯會", "函"),
    ).toBe("國立新竹高級中學主席班聯會函");
  });

  it("keeps the generic decree title when no issuer is selected", () => {
    expect(buildDocumentAutoTitle("decree", "", "令")).toBe("主席令");
  });
});
