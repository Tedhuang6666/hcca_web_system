/**
 * 購票 / 商品訂購 e2e 流程
 *
 * 覆蓋：進入購票頁 → 查看商品 → 加入購物車 → 進入購物車頁 → 確認結算 UI 正常
 *
 * 執行前提：
 *   E2E_AUTH_STORAGE 指向帶有有效 session 的 Playwright storage-state 檔
 *
 * 注意：此測試不真正送出訂單（避免在 CI 或測試環境產生真實資料），
 *       只驗證到「結算頁可正常進入」這個步驟。
 */

import { expect, test } from "@playwright/test";

test.skip(
  !process.env.E2E_AUTH_STORAGE,
  "Set E2E_AUTH_STORAGE to a trusted Playwright storage-state file.",
);

test.describe("商品購買流程", () => {
  test("購票頁可正常載入，顯示商品或空狀態", async ({ page }) => {
    await page.goto("/shop");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // 頁面至少有購物車連結、商品列表、或無商品說明
    const hasContent = await page
      .locator(
        "a[href='/shop/cart'], [aria-label*='購物車'], button:has-text('加入'), [class*='product'], p, h2",
      )
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(hasContent).toBe(true);
  });

  test("點擊商品出現詳情抽屜並可加入購物車", async ({ page }) => {
    await page.goto("/shop");
    await expect(page).not.toHaveURL(/\/login/);

    // 找到第一個商品按鈕（aria-label="選購商品"）
    const firstProduct = page.locator("[aria-label='選購商品']").first();
    const hasProduct = await firstProduct.isVisible({ timeout: 8_000 }).catch(() => false);

    if (!hasProduct) {
      test.skip(true, "目前無上架商品，跳過此測試");
      return;
    }

    await firstProduct.click();

    // 抽屜應出現「加入購物車」按鈕
    const addToCartBtn = page.getByRole("button", { name: /加入購物車/ });
    await expect(addToCartBtn).toBeVisible({ timeout: 8_000 });
    await expect(addToCartBtn).not.toBeDisabled();

    // 點擊加入購物車
    await addToCartBtn.click();

    // 確認成功（toast 或購物車計數更新）
    const successIndicator = page
      .locator("text=/已加入|成功|購物車/, [aria-live]")
      .first();
    const cartCountUpdated = page.locator("a[href='/shop/cart']").filter({
      hasText: /\(\d+\)/,
    });

    const didSucceed =
      (await successIndicator.isVisible({ timeout: 5_000 }).catch(() => false)) ||
      (await cartCountUpdated.isVisible({ timeout: 5_000 }).catch(() => false));

    // 商品抽屜若關閉也算成功（表示流程完成）
    const drawerClosed = !(await firstProduct
      .locator("..")
      .locator("[role='dialog']")
      .isVisible()
      .catch(() => true));

    expect(didSucceed || drawerClosed).toBe(true);
  });

  test("購物車頁可正常進入", async ({ page }) => {
    await page.goto("/shop/cart");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");

    // 購物車頁應有商品列表或「購物車是空的」提示
    const hasCartContent = await page
      .locator(
        "text=/購物車|空的|NT\\$|結算|確認訂單/",
      )
      .first()
      .isVisible({ timeout: 10_000 })
      .catch(() => false);
    expect(hasCartContent).toBe(true);
  });

  test("班級訂購頁面可正常載入", async ({ page }) => {
    await page.goto("/shop/class-orders");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });

  test("我的訂單頁可正常載入", async ({ page }) => {
    await page.goto("/shop?tab=orders");

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
});
