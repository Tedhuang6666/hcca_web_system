import { describe, expect, it } from "vitest";
import { administrativeDate, countLawArticles, regulationPublicState } from "./administrative";
import type { RegulationArticleOut } from "./types";

describe("行政公開資料", () => {
  it("只計算條，排除章節、項款目與已刪除條文", () => {
    const articles = ["chapter", "article", "paragraph", "subparagraph", "item", "section", "article"]
      .map((article_type, index) => ({ article_type, is_deleted: index === 6 })) as RegulationArticleOut[];
    expect(countLawArticles(articles)).toBe(1);
    expect(countLawArticles([])).toBe(0);
  });

  it("以臺北時區呈現發文日，不以無效或缺漏日期冒充正式日期", () => {
    expect(administrativeDate("2026-11-08T18:00:00Z")).toBe("115.11.09");
    expect(administrativeDate("2026-11-08T18:00:00Z", true)).toBe("中華民國115年11月9日");
    expect(administrativeDate(null)).toBe("未載明");
    expect(administrativeDate("invalid")).toBe("未載明");
  });

  it("公布、凍結、廢止與失效分開表達，不從公布狀態推定施行效力", () => {
    const regulation = { is_active: true, is_repealed: false, workflow_status: "published" as const, freeze_reason: null };
    expect(regulationPublicState(regulation)).toBe("已公布");
    expect(regulationPublicState({ ...regulation, is_repealed: true })).toBe("已廢止");
    expect(regulationPublicState({ ...regulation, freeze_reason: "暫停適用" })).toBe("凍結中");
    expect(regulationPublicState({ ...regulation, is_active: false })).toBe("已失效");
  });
});
