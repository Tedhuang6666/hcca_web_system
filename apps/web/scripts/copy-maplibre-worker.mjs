import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageDirectory = path.dirname(require.resolve("maplibre-gl/package.json"));
const workerDirectory = path.join(packageDirectory, "dist");
const publicDirectory = path.join(process.cwd(), "public", "maplibre");

mkdirSync(publicDirectory, { recursive: true });

for (const filename of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(workerDirectory, filename), path.join(publicDirectory, filename));
}
