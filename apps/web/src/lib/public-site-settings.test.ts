import { describe, expect, it } from "vitest";

import { mergeSavedSettings } from "./public-site-settings";
import type { PublicSiteSettingsOut } from "./types";

describe("mergeSavedSettings", () => {
  it("只回填已儲存欄位，保留其他分頁尚未儲存的修改", () => {
    const server = { site_title: "舊標題", contact_md: "舊聯絡", system_info_md: "系統" } as PublicSiteSettingsOut;
    const editing = { ...server, site_title: "未儲存的新標題", contact_md: "新聯絡" };
    const saved = { ...server, contact_md: "新聯絡" };

    const merged = mergeSavedSettings(editing, saved, ["contact_md"]);

    expect(merged.contact_md).toBe("新聯絡");
    expect(merged.site_title).toBe("未儲存的新標題");
  });
});
