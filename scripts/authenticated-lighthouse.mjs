import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const lighthouseModule = require("lighthouse");
const lighthouse = lighthouseModule.default || lighthouseModule;
const { launch: launchChrome } = require("chrome-launcher");

const baseUrl = (process.env.BASE_URL || "https://hcca.tw").replace(/\/$/u, "");
const monitorToken = process.env.PERFORMANCE_MONITOR_TOKEN || "";
const release = process.env.GITHUB_SHA || process.env.APP_RELEASE || "local";
const outputFile = process.env.OUTPUT_FILE || "authenticated-lighthouse-results.json";
const minimumScore = Number(process.env.MIN_SCORE || "95");

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
    const server = response.headers.get("server") || "unknown";
    const ray = response.headers.get("cf-ray") || "";
    throw new Error(
      `${path} returned HTTP ${response.status} server=${server} cf-ray=${ray} body=${body}`,
    );
  }
  return response.json();
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
    headers: { Cookie: cookieHeader },
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

// `/api/*` is the Cloudflare-approved API ingress; Caddy strips this prefix
// before forwarding to the token-protected FastAPI internal route.
const authSession = await requestJson("/api/internal/observability/auth-session", {
  method: "POST",
});
const cookieHeader = `${authSession.cookie_name}=${authSession.access_token}`;
const targetsResponse = await requestJson("/api/internal/observability/auth-targets");
const targets = [...new Set((targetsResponse.urls || []).map((value) => String(value)))].sort();

if (targets.length === 0) throw new Error("No authenticated performance targets were discovered");

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
try {
  for (const url of targets) {
    for (const strategy of ["mobile", "desktop"]) {
      process.stdout.write(`authenticated ${strategy} ${url}\n`);
      try {
        await assertAuthenticated(url, cookieHeader);
        runs.push(await runLighthouse(chrome, url, strategy, cookieHeader));
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
  }
} finally {
  await chrome.kill();
}

const persistenceBatchSize = 180;
for (let offset = 0; offset < runs.length; offset += persistenceBatchSize) {
  await requestJson("/api/internal/observability/authenticated-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ release, runs: runs.slice(offset, offset + persistenceBatchSize) }),
  });
}

const failures = runs.filter(
  (run) => run.status !== "ok" || run.performance_score == null || run.performance_score < minimumScore,
);
const summary = {
  release,
  minimum_score: minimumScore,
  targets: targets.length,
  runs: runs.length,
  passed: runs.length - failures.length,
  failed: failures.length,
  failures,
};
await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exitCode = 1;
