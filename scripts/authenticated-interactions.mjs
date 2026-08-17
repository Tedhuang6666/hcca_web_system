import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { launch: launchChrome } = require("chrome-launcher");
const { chromium } = require("playwright-core");

const baseUrl = (process.env.BASE_URL || "https://hcca.tw").replace(/\/$/u, "");
const monitorToken = process.env.PERFORMANCE_MONITOR_TOKEN || "";
const targetPath = process.env.INTERACTION_TARGET || "/merchandise-submissions";
const outputFile = process.env.OUTPUT_FILE || ".lighthouseci/authenticated-interactions.json";
const feedbackBudgetMs = Number(process.env.FEEDBACK_BUDGET_MS || "100");
const completionBudgetMs = Number(process.env.COMPLETION_BUDGET_MS || "500");
const warmupMs = Math.max(0, Number(process.env.WARMUP_MS || "0"));

if (!monitorToken) throw new Error("PERFORMANCE_MONITOR_TOKEN is required");

const monitorHeaders = {
  "X-Performance-Monitor-Token": monitorToken,
  Accept: "application/json",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...monitorHeaders,
      Origin: baseUrl,
      Referer: `${baseUrl}/`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).replace(/\s+/gu, " ").slice(0, 240);
    throw new Error(`${path} returned HTTP ${response.status}: ${body}`);
  }
  return response.json();
}

async function assertAuthenticated(url, cookieHeader) {
  const response = await fetch(url, {
    headers: { Cookie: cookieHeader },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`authenticated navigation redirected (${response.status})`);
  }
  if (!response.ok) throw new Error(`authenticated navigation returned HTTP ${response.status}`);
}

async function waitForActiveTopTab(page, selector) {
  await page.waitForFunction(
    (tabSelector) => {
      const element = document.querySelector(tabSelector);
      return element instanceof HTMLElement && element.style.borderColor !== "transparent";
    },
    selector,
    { timeout: 5_000 },
  );
}

async function measureAction(page, action, interactionResponses) {
  const startedAt = Date.now();
  const startMark = await page.evaluate(() => performance.now());
  const requestStart = Date.now();
  await action.trigger.click({ timeout: 5_000 });
  const feedbackAt = await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now()))),
  );
  await action.complete();
  const completedAt = await page.evaluate(() => performance.now());
  const api = interactionResponses
    .filter((response) => response.startedAt >= requestStart)
    .map((response) => ({ path: response.path, status: response.status, duration_ms: response.durationMs }));
  return {
    name: action.name,
    feedback_ms: Math.round(Math.max(0, feedbackAt - startMark) * 100) / 100,
    completion_ms: Math.round(Math.max(0, completedAt - startMark) * 100) / 100,
    api,
    measured_at: new Date(startedAt).toISOString(),
  };
}

const authSession = await requestJson("/api/internal/observability/auth-session", { method: "POST" });
const cookieHeader = `${authSession.cookie_name}=${authSession.access_token}`;
const chrome = await launchChrome({
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage"],
});
let browser;
  const results = [];
try {
  const url = `${baseUrl}${targetPath}`;
  await assertAuthenticated(url, cookieHeader);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const context = browser.contexts()[0];
  await context.addCookies([
    {
      name: authSession.cookie_name,
      value: authSession.access_token,
      url: `${baseUrl}/`,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  const interactionResponses = [];
  const requestStarted = new Map();
  page.on("request", (request) => {
    if (request.url().includes("/api/") && !request.url().includes("client-metrics")) {
      requestStarted.set(request, Date.now());
    }
  });
  page.on("response", (response) => {
    const startedAt = requestStarted.get(response.request());
    if (startedAt == null) return;
    interactionResponses.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      startedAt,
      durationMs: Date.now() - startedAt,
    });
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.locator('[data-performance-action="校商投稿／我要投稿"]').waitFor({ state: "visible", timeout: 30_000 });
  if (warmupMs > 0) await page.waitForTimeout(warmupMs);

  results.push(await measureAction(page, {
    name: "校商投稿／我的投稿",
    trigger: page.locator('[data-performance-action="校商投稿／我的投稿"]'),
    complete: async () => {
      await waitForActiveTopTab(page, '[data-performance-action="校商投稿／我的投稿"]');
      await page.locator('[data-performance-state="mine-ready"]').waitFor({ state: "visible", timeout: 15_000 });
    },
  }, interactionResponses));
  results.push(await measureAction(page, {
    name: "校商投稿／我要投稿",
    trigger: page.locator('[data-performance-action="校商投稿／我要投稿"]'),
    complete: () => waitForActiveTopTab(page, '[data-performance-action="校商投稿／我要投稿"]'),
  }, interactionResponses));
  results.push(await measureAction(page, {
    name: "校商投稿／下一步選擇商品",
    trigger: page.locator('[data-performance-action="校商投稿／下一步選擇商品"]'),
    complete: () => page.locator('[role="tab"][aria-selected="true"]').filter({ hasText: "選擇商品" }).waitFor({ state: "visible" }),
  }, interactionResponses));
  const item = page.locator('#merchandise-item-picker [data-performance-action^="校商投稿／選擇"]').first();
  if (await item.count() === 0) {
    results.push({
      name: "校商投稿／選擇第一個商品",
      status: "skipped",
      reason: "目前沒有可投稿品項",
    });
    results.push({
      name: "校商投稿／下一步查看投稿詳情",
      status: "skipped",
      reason: "目前沒有可投稿品項",
    });
  } else {
    await item.waitFor({ state: "visible", timeout: 5_000 });
    results.push(await measureAction(page, {
      name: "校商投稿／選擇第一個商品",
      trigger: item,
      complete: () => page.getByText("投稿詳情與圖稿", { exact: true }).waitFor({ state: "visible", timeout: 5_000 }),
    }, interactionResponses));
    results.push({
      name: "校商投稿／下一步查看投稿詳情",
      status: "skipped",
      reason: "選擇商品後已直接進入投稿詳情",
    });
  }
} finally {
  try {
    if (browser) await browser.close();
  } catch (error) {
    console.warn(`Chrome CDP cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await chrome.kill();
  } catch (error) {
    console.warn(`Chrome launcher cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const failures = results.filter(
  (result) => result.status !== "skipped" && (result.feedback_ms > feedbackBudgetMs || result.completion_ms > completionBudgetMs),
);
const summary = {
  target: `${baseUrl}${targetPath}`,
  feedback_budget_ms: feedbackBudgetMs,
  completion_budget_ms: completionBudgetMs,
  actions: results,
  passed: failures.length === 0,
  failures,
};
await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exitCode = 1;
