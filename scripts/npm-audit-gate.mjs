// npm audit 閘門：高風險以上一律失敗，僅允許下列已審查且上游尚無修補版的例外。
import { spawnSync } from "node:child_process";

// GHSA-fc5q-39xc-vjpf：picomatch <=4.0.7 ReDoS，npm 最新版 4.0.7 仍受影響、無可升級版本；
// 僅經 @sentry/nextjs 的建置期 rollup 外掛使用，不處理執行期使用者輸入。上游釋出修補後移除。
const ALLOWED = new Set(["GHSA-fc5q-39xc-vjpf"]);

const result = spawnSync(
  "npm",
  ["audit", "--prefix", "apps/web", "--omit=dev", "--audit-level=high", "--json"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
const report = JSON.parse(result.stdout || "{}");
const blocking = new Set();
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (!["high", "critical"].includes(vuln.severity)) continue;
  for (const advisory of vuln.via.filter((item) => typeof item === "object")) {
    const id = String(advisory.url ?? "").split("/").pop();
    if (!ALLOWED.has(id)) blocking.add(`${name}: ${advisory.title} (${advisory.url})`);
  }
}
if (blocking.size) {
  console.error("Unreviewed high/critical advisories:\n" + [...blocking].join("\n"));
  process.exit(1);
}
console.log(`npm audit gate OK (allowed exceptions: ${[...ALLOWED].join(", ")})`);
