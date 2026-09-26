import { describe, expect, it } from "vitest";

import {
  getExamScopeDefaultSection,
  getExamScopeGradeFromStudentId,
  parseExamScopeMarkdown,
} from "./exam-scope";

const markdown = `# 國文
## 計分方式
### 高一
定期考試 60%，平時成績 40%
### 高三
## 定期考試 60%，平時成績 40%
## 一段
### 高一
1. 課本 1～4 課
### 高三
1. 課本 1～3 課
# 數學
## 一段
### 高一
1. 實數
### 高三－數學甲
1. 複數`;

describe("parseExamScopeMarkdown", () => {
  it("groups subjects, stages, and grade variants for an exam-scope article", () => {
    const scope = parseExamScopeMarkdown(markdown);

    expect(scope?.subjects).toEqual(["國文", "數學"]);
    expect(scope?.grades).toEqual(["高一", "高三"]);
    expect(scope?.sections).toEqual(["計分方式", "一段"]);
    expect(scope?.entries).toHaveLength(6);
    expect(scope?.entries.find((entry) => entry.grade === "高三")?.content).toBe(
      "定期考試 60%，平時成績 40%",
    );
    expect(scope?.entries.find((entry) => entry.grade === "高三－數學甲")?.gradeGroup).toBe("高三");
  });

  it("leaves ordinary articles on the standard reader", () => {
    expect(parseExamScopeMarkdown("# 午餐指南\n## 校內學餐\n今天吃什麼？")).toBeNull();
  });

  it("reads only supported defaults and known student-id grade prefixes", () => {
    expect(getExamScopeDefaultSection({ exam_scope_default_section: "一段" })).toBe("一段");
    expect(getExamScopeDefaultSection({ exam_scope_default_section: "期中考" })).toBeNull();
    expect(getExamScopeGradeFromStudentId("03101234")).toBe("高三");
    expect(getExamScopeGradeFromStudentId("04101234")).toBe("高二");
    expect(getExamScopeGradeFromStudentId("05101234")).toBe("高一");
    expect(getExamScopeGradeFromStudentId("99101234")).toBeNull();
  });
});
