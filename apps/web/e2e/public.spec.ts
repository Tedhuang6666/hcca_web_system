import { expect, test } from "@playwright/test";

test("public homepage exposes primary navigation", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src[^;]*nonce-/);

  const html = await response!.text();
  const inlineExecutableScriptsWithoutNonce = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .map((match) => match[1] ?? "")
    .filter((attributes) => !/\bsrc\s*=/.test(attributes))
    .filter((attributes) => !/\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes))
    .filter((attributes) => !/\bnonce\s*=/.test(attributes)).length;
  expect(inlineExecutableScriptsWithoutNonce).toBe(0);

  await expect(
    page.getByRole("heading", { name: /新竹高中班聯會|讓校園自治/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /最新公告/ }).first()).toBeVisible();
});

test("login page exposes OAuth entry points", async ({ page }) => {
  const cspViolations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|csp/i.test(message.text())) {
      cspViolations.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    if (/content security policy|csp/i.test(error.message)) cspViolations.push(error.message);
  });

  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src[^;]*nonce-/);
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);

  const html = await response!.text();
  const inlineScriptsWithoutNonce = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .map((match) => match[1] ?? "")
    .filter((attributes) => !/\bsrc\s*=/.test(attributes))
    .filter((attributes) => !/\bnonce\s*=/.test(attributes)).length;
  expect(inlineScriptsWithoutNonce).toBe(0);

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
  await expect(page.getByRole("link", { name: /Google/ })).toBeEnabled();
  expect(cspViolations).toEqual([]);
});
