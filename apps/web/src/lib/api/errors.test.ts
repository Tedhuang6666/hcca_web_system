import { describe, expect, it } from "vitest";

import { errorMessageFromResponse, formatErrorDetail, statusMessage } from "./errors";

describe("formatErrorDetail", () => {
  it("turns Pydantic validation errors into readable Chinese without field paths", () => {
    const detail = [
      { type: "string_too_long", loc: ["body", "title"], msg: "String should have at most 200 characters" },
      { type: "missing", loc: ["body", "content"], msg: "Field required" },
    ];
    expect(formatErrorDetail(detail, "失敗")).toBe("內容超過長度上限；有必填欄位尚未填寫");
  });

  it("keeps custom Chinese validator messages", () => {
    const detail = [{ type: "value_error", loc: ["body"], msg: "Value error, 必須指定付款人" }];
    expect(formatErrorDetail(detail, "失敗")).toBe("必須指定付款人");
  });

  it("never shows raw JSON objects", () => {
    expect(formatErrorDetail({ code: 17, internal: true }, "操作失敗")).toBe("操作失敗");
  });
});

describe("errorMessageFromResponse", () => {
  it("uses a Chinese status message for non-JSON gateway errors", async () => {
    const response = new Response("<html>Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" });
    expect(await errorMessageFromResponse(response)).toBe("系統暫時無法處理，請稍後再試");
  });

  it("maps common statuses", () => {
    expect(statusMessage(429)).toBe("操作太頻繁，請稍後再試");
    expect(statusMessage(404)).toBe("找不到這筆資料");
  });
});
