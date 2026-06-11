import { expect, test } from "@playwright/test";

test("public homepage exposes primary navigation", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /新竹高中班聯會|讓校園自治/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /最新公告/ }).first()).toBeVisible();
});

test("login page exposes OAuth entry points", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: /登入|校園自治|歡迎回來/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Google/ })).toHaveAttribute(
    "href",
    /auth\/google\/login/,
  );
  await expect(page.getByRole("link", { name: /Discord/ })).toHaveAttribute(
    "href",
    /auth\/discord\/login/,
  );
});
