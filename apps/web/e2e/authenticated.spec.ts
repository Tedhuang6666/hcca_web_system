import { expect, test } from "@playwright/test";

test.skip(
  !process.env.E2E_AUTH_STORAGE,
  "Set E2E_AUTH_STORAGE to a trusted Playwright storage-state file.",
);

const workflows = [
  { name: "MFA", path: "/auth/mfa" },
  { name: "公文建立", path: "/documents/new" },
  { name: "會議", path: "/meetings" },
  { name: "購票", path: "/shop" },
  { name: "學餐", path: "/meal" },
  { name: "問卷", path: "/surveys" },
];

for (const workflow of workflows) {
  test(`${workflow.name} authenticated smoke`, async ({ page }) => {
    await page.goto(workflow.path);

    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page.locator("body")).not.toContainText("Internal Server Error");
  });
}
