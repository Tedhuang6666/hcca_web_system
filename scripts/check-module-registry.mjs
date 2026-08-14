import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontend = await readFile(resolve(root, "apps/web/src/lib/route-manifest.ts"), "utf8");
const backend = await readFile(resolve(root, "apps/api/src/api/core/modules.py"), "utf8");

const frontendBlock = frontend.match(/export const MODULE_MANIFEST = \{([\s\S]*?)\n\} as const;/)?.[1] ?? "";
const frontendIds = [...frontendBlock.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]);
const backendBlock = backend.match(/MODULES: dict\[str, ModuleSpec\] = \{([\s\S]*?)\n\}\n\nMODULE_IDS/)?.[1] ?? "";
const backendIds = [...backendBlock.matchAll(/^    "([A-Za-z][A-Za-z0-9]*)":/gm)].map((match) => match[1]);

const sortIds = (ids) => [...new Set(ids)].sort();
const expected = sortIds(frontendIds);
const actual = sortIds(backendIds);
const missingInBackend = expected.filter((id) => !actual.includes(id));
const missingInFrontend = actual.filter((id) => !expected.includes(id));

if (missingInBackend.length || missingInFrontend.length) {
  console.error(JSON.stringify({ missingInBackend, missingInFrontend }, null, 2));
  process.exit(1);
}

console.log(`Module registry is aligned (${expected.length} module IDs).`);
