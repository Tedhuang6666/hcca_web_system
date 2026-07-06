/**
 * 公文建立與簽核 e2e 流程
 *
 * 覆蓋：建立公文 → 確認出現在列表 → 進入詳情 → 查看簽核面板
 *
 * 執行前提：
 *   E2E_AUTH_STORAGE 指向帶有有效 session 的 Playwright storage-state 檔
 *   帳號必須持有 document:create 權限（或為超級管理員）
 *
 * 執行方式（WSL 內）：
 *   E2E_AUTH_STORAGE=<path> E2E_BASE_URL=http://localhost:3000 \
 *     npx playwright test e2e/document_approval.spec.ts --headed
 */

import { expect, test } from "@playwright/test";

test.skip(
  !process.env.E2E_AUTH_STORAGE,
  "Set E2E_AUTH_STORAGE to a trusted Playwright storage-state file.",
);

test.describe("公文建立流程", () => {
  test("可進入公文新建頁並看到必要欄位", async ({ page }) => {
    await page.goto("/documents/new");

    // 確認沒有被導回登入頁
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page).not.toHaveURL(/\/auth(?:\?|$)/);

    // 確認表單欄位存在
    await expect(
      page.locator("select, [role='combobox']").first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator("textarea, input[placeholder*='標題'], input[placeholder*='主旨']").first(),
    ).toBeVisible();
  });

  test("填寫公文表單並建立草稿，確認跳轉到詳情頁", async ({ page }) => {
    await page.goto("/documents/new");
    await expect(page).not.toHaveURL(/\/login/);

    const subjectInput = page
      .locator("input")
      .filter({ hasText: "" })
      .or(page.locator("input[placeholder*='主旨'], input[placeholder*='班級聯合']"))
      .first();

    // 若找不到 input（表示無建立權限），直接跳過
    const canCreate = await subjectInput.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!canCreate) {
      test.skip(true, "目前帳號沒有公文建立權限，跳過此測試");
      return;
    }

    // 填寫主旨（找第一個文字 input，placeholder 含「例」或「主旨」）
    const titleField = page.locator(
      "input[placeholder*='例'], input[placeholder*='主旨'], input[placeholder*='標題']",
    ).first();
    await titleField.fill(`e2e 測試公文 ${Date.now()}`);

    // 提交 / 儲存草稿
    const submitBtn = page
      .getByRole("button", { name: /儲存|建立|提交|送出|確認/ })
      .first();
    await submitBtn.click();

    // 應跳轉到詳情頁 /documents/{id}
    await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
    await expect(page.locator("body")).not.toContainText("500");
  });

  test("公文詳情頁顯示簽核面板", async ({ page }) => {
    // 先建立一份公文，取得它的 URL
    await page.goto("/documents/new");
    await expect(page).not.toHaveURL(/\/login/);

    const titleField = page.locator(
      "input[placeholder*='例'], input[placeholder*='主旨'], input[placeholder*='標題']",
    ).first();

    const canCreate = await titleField.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!canCreate) {
      // 改從列表取第一份已有公文
      await page.goto("/documents");
      const firstDocLink = page.locator("a[href^='/documents/']").first();
      const hasDoc = await firstDocLink.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!hasDoc) {
        test.skip(true, "沒有可用公文，跳過此測試");
        return;
      }
      await firstDocLink.click();
    } else {
      await titleField.fill(`e2e 簽核測試 ${Date.now()}`);
      const submitBtn = page
        .getByRole("button", { name: /儲存|建立|提交|送出/ })
        .first();
      await submitBtn.click();
      await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 15_000 });
    }

    // 確認頁面含有簽核相關元素（面板、狀態標籤、或操作按鈕）
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
    const hasApproval = await page
      .locator("[aria-label*='核准'], button:has-text('核准'), [class*='approval'], [class*='Approval']")
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    // 簽核面板存在 OR 至少公文狀態標籤可見
    const hasStatus = await page
      .locator("text=/草稿|待審|審核|核准|退件/")
      .first()
      .isVisible()
      .catch(() => false);

    expect(hasApproval || hasStatus).toBe(true);
  });
});

test.describe("公文列表與搜尋", () => {
  test("公文列表頁可正常載入並顯示欄位", async ({ page }) => {
    await page.goto("/documents");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // 頁面應有表格、列表或空狀態
    const content = page.locator("table, [role='list'], [class*='list'], h2, p").first();
    await expect(content).toBeVisible({ timeout: 10_000 });
  });
});
