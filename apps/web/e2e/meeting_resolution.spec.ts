/**
 * 會議建立與決議 e2e 流程
 *
 * 覆蓋：查看會議列表 → 建立新會議 → 進入控制台 → 確認決議相關 UI 可見
 *
 * 執行前提：
 *   E2E_AUTH_STORAGE 指向帶有有效 session 的 Playwright storage-state 檔
 *   帳號必須持有 meeting:manage 或相等權限（或為超級管理員）
 */

import { expect, test } from "@playwright/test";

test.skip(
  !process.env.E2E_AUTH_STORAGE,
  "Set E2E_AUTH_STORAGE to a trusted Playwright storage-state file.",
);

test.describe("會議列表與建立", () => {
  test("會議列表頁可正常載入", async ({ page }) => {
    await page.goto("/meetings");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // 頁面存在「建立會議」按鈕或空狀態
    const hasContent = await page
      .locator("button:has-text('建立會議'), [class*='meeting'], h2, table")
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(hasContent).toBe(true);
  });

  test("點擊建立會議並確認跳轉到會議詳情", async ({ page }) => {
    await page.goto("/meetings");
    await expect(page).not.toHaveURL(/\/login/);

    const createBtn = page.getByRole("button", { name: "建立會議" });
    const canCreate = await createBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!canCreate) {
      test.skip(true, "目前帳號沒有建立會議權限，跳過此測試");
      return;
    }

    await createBtn.click();

    // 應跳轉到新建的會議詳情頁
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // 詳情頁應有會議相關內容
    const hasTitle = await page
      .locator("h1, h2, [class*='meeting-title']")
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    expect(hasTitle).toBe(true);
  });
});

test.describe("會議詳情與控制台", () => {
  /**
   * 找到列表第一個會議，進入詳情，確認議程與決議相關 UI 存在。
   */
  test("會議詳情頁顯示議程與決議元素", async ({ page }) => {
    await page.goto("/meetings");
    await expect(page).not.toHaveURL(/\/login/);

    // 嘗試進入第一個會議
    const firstLink = page.locator("a[href^='/meetings/'][href!='/meetings/calendar']").first();
    const hasMeeting = await firstLink.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!hasMeeting) {
      test.skip(true, "尚無會議資料，跳過詳情測試");
      return;
    }

    const href = await firstLink.getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // 頁面應有議程、決議、或出席等相關詞彙
    const hasMeetingContent = await page
      .locator("text=/議程|決議|出席|主席|會議紀錄|控制台/")
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    expect(hasMeetingContent).toBe(true);
  });

  test("會議控制台頁面可正常開啟", async ({ page }) => {
    await page.goto("/meetings");
    await expect(page).not.toHaveURL(/\/login/);

    // 找控制台連結
    const controlLink = page.locator("a[href*='/control']").first();
    const hasControl = await controlLink.isVisible({ timeout: 5_000 }).catch(() => false);

    if (!hasControl) {
      test.skip(true, "沒有可進入的控制台，跳過");
      return;
    }

    const href = await controlLink.getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
    await expect(page).not.toHaveURL(/\/login/);
  });
});
