import { describe, expect, it } from "vitest";
import { buildRegulationDiffRows } from "./regulationDiff";

describe("buildRegulationDiffRows", () => {
  it("keeps lines unchanged when only internal whitespace differs", () => {
    const rows = buildRegulationDiffRows(
      "### 第 30 條\n102學年度第二學期第一次班代會修訂",
      "### 第30條\n102 學年度第二學期第一次班代會修訂",
    );

    expect(rows).toEqual([
      { type: "equal", text: "### 第30條" },
      { type: "equal", text: "102 學年度第二學期第一次班代會修訂" },
    ]);
  });

  it("highlights changed words within a replaced clause", () => {
    const rows = buildRegulationDiffRows(
      "第 31 條\n評議委員會有七人，由學生會任命。\n第 32 條",
      "第 31 條\n評議委員會有七人，由議員互選。\n第 32 條",
    );

    expect(rows.map(({ type }) => type)).toEqual(["equal", "remove", "add", "equal"]);
    expect(rows[1].segments?.filter(({ type }) => type === "remove").map(({ text }) => text).join("")).toBe("學生會任命");
    expect(rows[2].segments?.filter(({ type }) => type === "add").map(({ text }) => text).join("")).toBe("議員互選");
  });

  it("pairs multiple corresponding lines and isolates punctuation changes", () => {
    const rows = buildRegulationDiffRows(
      "1. 解釋章程。\n2. 審查處分。\n3. 審理案件。",
      "1、解釋章程。\n2、審查處分。\n3、審理案件。",
    );

    expect(rows.map(({ type }) => type)).toEqual(["remove", "add", "remove", "add", "remove", "add"]);
    const changedRemovedText = rows
      .filter(({ type }) => type === "remove")
      .map(({ segments }) => segments
        ?.filter(({ type }) => type === "remove")
        .map(({ text }) => text)
        .join("")
        .replace(/\s/gu, ""));
    const changedAddedText = rows
      .filter(({ type }) => type === "add")
      .map(({ segments }) => segments
        ?.filter(({ type }) => type === "add")
        .map(({ text }) => text)
        .join("")
        .replace(/\s/gu, ""));

    expect(changedRemovedText).toEqual([".", ".", "."]);
    expect(changedAddedText).toEqual(["、", "、", "、"]);
  });

  it("preserves added and deleted lines", () => {
    const rows = buildRegulationDiffRows("第一條\n第二條\n第三條", "第一條\n新條文");

    expect(rows).toEqual([
      { type: "equal", text: "第一條" },
      { type: "remove", text: "第二條" },
      { type: "remove", text: "第三條" },
      { type: "add", text: "新條文" },
    ]);
  });
});
