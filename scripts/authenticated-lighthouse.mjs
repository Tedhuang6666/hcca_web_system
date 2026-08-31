import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const lighthouseModule = require("lighthouse");
const lighthouse = lighthouseModule.default || lighthouseModule;
const { launch: launchChrome } = require("chrome-launcher");
const { chromium } = require("playwright-core");

const baseUrl = (process.env.BASE_URL || "https://hcca.tw").replace(/\/$/u, "");
const monitorToken = process.env.PERFORMANCE_MONITOR_TOKEN || "";
const authenticated = process.env.AUTHENTICATED !== "false";
const release = process.env.GITHUB_SHA || process.env.APP_RELEASE || "local";
const outputFile = process.env.OUTPUT_FILE || "authenticated-lighthouse-results.json";
const minimumScore = Number(process.env.MIN_SCORE || "95");
const lighthouseAttempts = Math.max(
  1,
  Number.parseInt(process.env.LIGHTHOUSE_ATTEMPTS || "2", 10) || 2,
);

if (!monitorToken) {
  throw new Error("PERFORMANCE_MONITOR_TOKEN is required");
}

const monitorHeaders = {
  "X-Performance-Monitor-Token": monitorToken,
  Accept: "application/json",
  "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};

async function requestJson(path, init = {}, { retries = 5 } = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...monitorHeaders,
        Origin: baseUrl,
        Referer: `${baseUrl}/`,
        ...(init.headers || {}),
      },
    });
    if (response.ok) return response.json();

    const body = (await response.text()).replace(/\s+/gu, " ").slice(0, 240);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === retries - 1) {
      const server = response.headers.get("server") || "unknown";
      const ray = response.headers.get("cf-ray") || "";
      throw new Error(
        `${path} returned HTTP ${response.status} server=${server} cf-ray=${ray} body=${body}`,
      );
    }

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(60_000, retryAfterSeconds * 1_000)
      : Math.min(60_000, 2_000 * 2 ** attempt);
    process.stdout.write(
      `retry ${path} status=${response.status} attempt=${attempt + 1}/${retries} ` +
        `wait_ms=${backoffMs}\n`,
    );
    await delay(backoffMs);
  }
  throw new Error(`${path} request retry loop exhausted`);
}

function auditValue(audits, id) {
  const audit = audits?.[id];
  if (!audit) return null;
  return {
    id,
    title: audit.title || id,
    score: typeof audit.score === "number" ? audit.score : null,
    numeric_value: typeof audit.numericValue === "number" ? audit.numericValue : null,
    display_value: audit.displayValue || null,
  };
}

async function assertAuthenticated(url, cookieHeader) {
  const response = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      "Accept-Language": monitorHeaders["Accept-Language"],
      "User-Agent": monitorHeaders["User-Agent"],
    },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`authenticated navigation redirected (${response.status})`);
  }
  if (!response.ok) throw new Error(`authenticated navigation returned HTTP ${response.status}`);
  const finalUrl = response.url || url;
  if (new URL(finalUrl).pathname === "/login") {
    throw new Error("authenticated navigation reached /login");
  }
}

async function isHtmlPage(url, cookieHeader) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: {
        Cookie: cookieHeader,
        Accept: "text/html",
        "Accept-Language": monitorHeaders["Accept-Language"],
        "User-Agent": monitorHeaders["User-Agent"],
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const isPage = response.ok && contentType.includes("text/html");
    await response.body?.cancel();
    return { isPage, status: response.status, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

const appDirectory = fileURLToPath(new URL("../apps/web/src/app/", import.meta.url));
const pageFilePattern = /^page\.(?:tsx?|jsx?|mjs)$/u;
// These routes are aliases or operational shells rather than stable public content pages.
// They are either redirected, explicitly noindexed, or can render without an LCP score.
const performanceExcludedRoutes = new Set([
  "/public/documents",
  "/public/regulations",
  "/login",
  "/maintenance",
  "/module-status",
]);

async function discoverStaticRoutes(directory = appDirectory, segments = [], publicOnly = false) {
  const entries = await readdir(directory, { withFileTypes: true });
  const routes = entries.some((entry) => entry.isFile() && pageFilePattern.test(entry.name))
    ? [`/${segments.join("/")}`.replace(/\/+/gu, "/").replace(/\/$/u, "") || "/"]
    : [];

  const childRoutes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".") && !entry.name.startsWith("[") && !entry.name.startsWith("@"))
      .filter((entry) => !publicOnly || !["(protected)", "(admin)"].includes(entry.name))
      .map((entry) => {
        const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        const nextSegments = isRouteGroup ? segments : [...segments, entry.name];
        return discoverStaticRoutes(join(directory, entry.name), nextSegments, publicOnly);
      }),
  );
  return [...routes, ...childRoutes.flat()];
}

async function runLighthouse(chrome, url, strategy, cookieHeader) {
  const mobile = strategy === "mobile";
  const result = await lighthouse(url, {
    port: chrome.port,
    logLevel: "error",
    output: "json",
    onlyCategories: ["performance"],
    extraHeaders: { Cookie: cookieHeader },
    throttlingMethod: "simulate",
    formFactor: mobile ? "mobile" : "desktop",
    screenEmulation: mobile
      ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }
      : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  });
  const report = result?.lhr;
  const score = report?.categories?.performance?.score;
  if (!report || typeof score !== "number") {
    throw new Error("Lighthouse returned no performance score");
  }
  const audits = report.audits || {};
  return {
    url,
    strategy,
    performance_score: Math.round(score * 10000) / 100,
    lcp_ms: audits["largest-contentful-paint"]?.numericValue ?? null,
    tbt_ms: audits["total-blocking-time"]?.numericValue ?? null,
    cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    status: "ok",
    audits: [
      "largest-contentful-paint",
      "first-contentful-paint",
      "interaction-to-next-paint",
      "total-blocking-time",
      "cumulative-layout-shift",
      "server-response-time",
      "speed-index",
    ].map((id) => auditValue(audits, id)).filter(Boolean),
  };
}

async function runLighthouseWithRetry(chrome, url, strategy, cookieHeader) {
  for (let attempt = 1; attempt <= lighthouseAttempts; attempt += 1) {
    try {
      return await runLighthouse(chrome, url, strategy, cookieHeader);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isMissingScore = message === "Lighthouse returned no performance score";
      if (!isMissingScore || attempt === lighthouseAttempts) throw error;

      // Chrome occasionally produces a report without FCP during a headless
      // navigation. Retrying this transient result avoids failing the whole
      // monitoring run while preserving failures for real collection errors.
      process.stdout.write(
        `retry Lighthouse ${strategy} ${url} attempt=${attempt + 1}/${lighthouseAttempts}\n`,
      );
      await delay(2_000);
    }
  }
  throw new Error("Lighthouse retry loop exhausted");
}

// `/api/*` is the Cloudflare-approved API ingress; Caddy strips this prefix
// before forwarding to the token-protected FastAPI internal route.
const authSession = authenticated
  ? await requestJson("/api/internal/observability/auth-session", { method: "POST" })
  : null;
const cookieHeader = authSession ? `${authSession.cookie_name}=${authSession.access_token}` : "";
const targetsResponse = await requestJson(
  authenticated
    ? "/api/internal/observability/auth-targets"
    : "/api/internal/observability/public-targets",
);
let staticRoutes = [];
if (!authenticated) {
  try {
    staticRoutes = await discoverStaticRoutes(appDirectory, [], true);
  } catch (error) {
    process.stdout.write(
      `static route discovery unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
const staticTargets = staticRoutes
  .filter((route) => !performanceExcludedRoutes.has(route))
  .map((route) => `${baseUrl}${route}`);
const reportedTargets = (targetsResponse.urls || [])
  .map((value) => String(value))
  .filter((target) => !performanceExcludedRoutes.has(new URL(target, baseUrl).pathname));
const allTargets = [
  ...new Set([...staticTargets, ...reportedTargets]),
].sort();
const explicitTargetOffset = Math.max(0, Number.parseInt(process.env.TARGET_OFFSET || "0", 10) || 0);
const explicitTargetLimit = Math.max(0, Number.parseInt(process.env.TARGET_LIMIT || "0", 10) || 0);
const shardIndex = Math.max(0, Number.parseInt(process.env.TARGET_SHARD_INDEX || "0", 10) || 0);
const shardCount = Math.max(1, Number.parseInt(process.env.TARGET_SHARD_COUNT || "1", 10) || 1);
const shardSize = shardCount > 1 ? Math.ceil(allTargets.length / shardCount) : 0;
const targetOffset = explicitTargetOffset || (shardCount > 1 ? shardIndex * shardSize : 0);
const targetLimit = explicitTargetLimit || (shardCount > 1 ? shardSize : 0);
const targetFilter = (process.env.TARGET_URL || "").trim();
const targetsToCheck = targetFilter
  ? allTargets.filter((target) => target === targetFilter)
  : targetLimit > 0
    ? allTargets.slice(targetOffset, targetOffset + targetLimit)
    : allTargets.slice(targetOffset);
const pageCandidates = [];
// Keep preflight requests bounded; the workflow itself serializes browser
// shards so synthetic collection cannot become a production load test.
const pageCheckConcurrency = 4;
for (let offset = 0; offset < targetsToCheck.length; offset += pageCheckConcurrency) {
  const checked = await Promise.all(
    targetsToCheck.slice(offset, offset + pageCheckConcurrency).map(async (target) => {
      try {
        return { target, ...(await isHtmlPage(target, cookieHeader)) };
      } catch (error) {
        return {
          target,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  for (const result of checked) {
    if (result.isPage) pageCandidates.push(result.target);
    else if (result.error) process.stdout.write(`skip unavailable ${result.target}: ${result.error}\n`);
    else {
      process.stdout.write(
        `skip non-page ${result.target} status=${result.status ?? "unknown"} ` +
          `content-type=${result.contentType || "unknown"}\n`,
      );
    }
  }
}
const targets = pageCandidates;

if (targets.length === 0) {
  if (allTargets.length === 0) throw new Error("No performance targets were discovered");
  process.stdout.write(`shard ${shardIndex} has no HTML targets; skipping\n`);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(
    outputFile,
    `${JSON.stringify({ authenticated, release, targets_total: allTargets.length, targets: 0, runs: 0, passed: 0, failed: 0 }, null, 2)}\n`,
    "utf8",
  );
  process.exit(0);
}

const chrome = await launchChrome({
  chromeFlags: [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});

const runs = [];
const persistenceBatchSize = 10;
let persistedRuns = 0;

async function persistRuns(batch) {
  if (batch.length === 0) return;
  await requestJson(
    authenticated
      ? "/api/internal/observability/authenticated-runs"
      : "/api/internal/observability/public-runs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release, runs: batch }),
    },
    { retries: 10 },
  );
}

let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
  const context = browser.contexts()[0];
  if (authenticated && authSession) {
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
  }
  for (const url of targets) {
    for (const strategy of ["mobile", "desktop"]) {
      process.stdout.write(`${authenticated ? "authenticated" : "public"} ${strategy} ${url}\n`);
      try {
        if (authenticated) await assertAuthenticated(url, cookieHeader);
        runs.push(await runLighthouseWithRetry(chrome, url, strategy, cookieHeader));
      } catch (error) {
        runs.push({
          url,
          strategy,
          status: "error",
          error_message: error instanceof Error ? error.message : String(error),
          performance_score: null,
          lcp_ms: null,
          tbt_ms: null,
          cls: null,
          audits: [],
        });
      }
    }
    if (runs.length - persistedRuns >= persistenceBatchSize) {
      await persistRuns(runs.slice(persistedRuns));
      persistedRuns = runs.length;
    }
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

await persistRuns(runs.slice(persistedRuns));
persistedRuns = runs.length;

const collectionFailures = runs.filter(
  (run) => run.status !== "ok" || run.performance_score == null,
);
const budgetFailures = runs.filter(
  (run) => run.status === "ok" && run.performance_score != null && run.performance_score < minimumScore,
);
const summary = {
  authenticated,
  release,
  targets_total: allTargets.length,
  static_routes_total: staticRoutes.length,
  page_candidates_total: pageCandidates.length,
  target_offset: targetOffset,
  target_shard_index: shardIndex,
  target_shard_count: shardCount,
  target_filter: targetFilter || null,
  candidate_targets: targets.length,
  skipped_targets: targetsToCheck.length - pageCandidates.length,
  target_urls: targets,
  minimum_score: minimumScore,
  targets: targets.length,
  runs: runs.length,
  persisted_runs: persistedRuns,
  collected: runs.length - collectionFailures.length,
  passed: runs.length - collectionFailures.length - budgetFailures.length,
  failed: collectionFailures.length,
  collection_failed: collectionFailures.length,
  budget_failed: budgetFailures.length,
  failures: collectionFailures,
  budget_failures: budgetFailures.map(({ url, strategy, performance_score }) => ({
    url,
    strategy,
    performance_score,
  })),
};
await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (budgetFailures.length > 0) {
  const lowestScore = Math.min(...budgetFailures.map((run) => run.performance_score));
  console.warn(
    `::warning title=Lighthouse performance budget::${budgetFailures.length} run(s) scored below ` +
      `${minimumScore}; lowest score: ${lowestScore}. See ${outputFile} for details.`,
  );
}
if (collectionFailures.length > 0) process.exitCode = 1;
