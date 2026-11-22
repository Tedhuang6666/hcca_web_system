import { describe, expect, it } from "vitest";

import { buildDocumentAutoTitle } from "./document-title";

describe("buildDocumentAutoTitle", () => {
  it("uses the full council name once in decree titles", () => {
    const title = buildDocumentAutoTitle(
      "decree",
      "國立新竹高級中學主席班聯會",
      "令",
    );

    expect(title).toBe("國立新竹高級中學班級聯合自治會主席令");
    expect(title.match(/主席/g)).toHaveLength(1);
  });

  it("keeps the official decree title when no issuer is selected", () => {
    expect(buildDocumentAutoTitle("decree", "", "令")).toBe(
      "國立新竹高級中學班級聯合自治會主席令",
    );
  });

  it("keeps the full issuer name for other document categories", () => {
    expect(
      buildDocumentAutoTitle("letter", "國立新竹高級中學主席班聯會", "函"),
    ).toBe("國立新竹高級中學主席班聯會函");
  });
});
