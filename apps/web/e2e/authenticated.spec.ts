import { expect, test } from "@playwright/test";

const workflows = [
  { name: "MFA", path: "/auth/mfa" },
  { name: "公文建立", path: "/documents/new" },
  { name: "購票", path: "/shop" },
  { name: "新建問卷", path: "/surveys/new" },
  { name: "我的訂單", path: "/shop/orders" },
];

for (const workflow of workflows) {
  test(`${workflow.name} authenticated smoke`, async ({ page }) => {
    await page.goto(workflow.path);

    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
}
