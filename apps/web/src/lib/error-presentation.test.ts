import { describe, expect, it } from "vitest";

import { errorPresentation } from "./error-presentation";

describe("error presentation", () => {
  it.each([
    [0, "目前沒有網路連線"],
    [401, "登入狀態已失效"],
    [403, "目前沒有這項權限"],
    [404, "找不到這個內容"],
    [409, "資料已被更新"],
    [422, "請檢查輸入內容"],
    [429, "操作太頻繁"],
    [503, "服務暫時忙碌或維護中"],
  ])("gives status %s a specific next action", (status, title) => {
    const error = { status };
    expect(errorPresentation(error).title).toBe(title);
    expect(errorPresentation(error).action.length).toBeGreaterThan(0);
  });

  it("maps unknown 5xx failures to a retryable server message", () => {
    expect(errorPresentation({ status: 500 })).toMatchObject({ tone: "danger", action: "重新整理" });
  });
});
