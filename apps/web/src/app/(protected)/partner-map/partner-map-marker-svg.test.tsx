import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookmarkCheck, Landmark, Sandwich, School, TrainFront } from "lucide-react";
import { describe, expect, it } from "vitest";
import { PARTNER_ICON_OPTIONS } from "./partner-map-icons";
import { mapMarkerSvg } from "./partner-map-marker-svg";

const markerIcons = new Set([
  ...PARTNER_ICON_OPTIONS.map(option => option.icon), BookmarkCheck, Landmark, Sandwich, School, TrainFront,
]);

describe("prebuilt map marker SVGs", () => {
  it("preserves the exact category and landmark markup without a browser server renderer", () => {
    for (const icon of markerIcons) {
      for (const [size, strokeWidth] of [[14, 2.2], [19, 2.4], [22, 2.3]]) {
        const previous = renderToStaticMarkup(createElement(icon, { size, strokeWidth, "aria-hidden": "true" }));
        expect(mapMarkerSvg(icon, size, strokeWidth)).toBe(previous);
      }
    }
  });

  it("stays synchronized with the map icon imports and installed icon version", () => {
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../scripts/generate-partner-map-marker-svg.mjs");
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });
});
