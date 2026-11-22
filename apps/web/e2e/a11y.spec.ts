import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  "/",
  "/login",
  "/legal/privacy",
  "/legal/terms",
  "/legal/accessibility",
  "/legal/cookie",
  "/legal/security-policy",
  "/about",
];

for (const route of routes) {
  test(`WCAG 2.1 AA accessibility: ${route}`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status(), `${route} should return a successful response`).toBe(200);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const violations = results.violations.map((violation) => ({
      impact: violation.impact,
      id: violation.id,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));

    expect(violations).toEqual([]);
  });
}
