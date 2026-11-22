/**
 * 商品登記流程
 *
 * 驗證商品頁、商品詳情、舊購物車連結相容導向、班級訂購與訂單查詢頁。
 * 不送出登記，避免在共用或正式資料上新增訂單。
 *
 * 執行前提：E2E_AUTH_STORAGE 指向帶有有效 session 的 Playwright storage-state 檔。
 */

import { expect, test, type Page } from "@playwright/test";

async function assertRouteAvailable(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status(), `${path} should load successfully`).toBe(200);
}

test.describe("商品登記流程", () => {
  test("商品頁可正常載入，顯示商品或空狀態", async ({ page }) => {
    await assertRouteAvailable(page, "/shop");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
    await expect(
      page.locator("[aria-label^='查看商品：'], .shop-public-empty").first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("商品詳情顯示登記資訊且可用鍵盤關閉", async ({ page }) => {
    await assertRouteAvailable(page, "/shop");
    await expect(page).not.toHaveURL(/\/login/);

    const firstProduct = page.locator("[aria-label^='查看商品：']").first();
    if (!(await firstProduct.isVisible({ timeout: 8_000 }).catch(() => false))) {
      test.skip(true, "目前沒有可查看的上架商品");
      return;
    }
    if (
      (await firstProduct.getAttribute("aria-disabled")) === "true" ||
      (await firstProduct.isDisabled().catch(() => false))
    ) {
      test.skip(true, "目前沒有可操作的上架商品");
      return;
    }

    const productName = await firstProduct.locator("h4").innerText();
    await firstProduct.click();
    await expect(page.locator("#product-modal-title")).toHaveText(productName, { timeout: 8_000 });
    await expect(page.getByRole("button", { name: "關閉" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#product-modal-title")).toBeHidden();
  });

  test("舊購物車連結導向現行商品登記頁", async ({ page }) => {
    await assertRouteAvailable(page, "/shop/cart");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page).toHaveURL(/\/shop\/?$/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });

  test("班級訂購頁面可正常載入", async ({ page }) => {
    await assertRouteAvailable(page, "/shop/class-orders");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });

  test("我的訂單頁可正常載入", async ({ page }) => {
    await assertRouteAvailable(page, "/shop/orders");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});
